// src/recorder/AdvancedRecorder.js
const { screen, getActiveWindow, Region, Point } = require("@nut-tree-fork/nut-js");
const { uIOhook: iohook } = require('uiohook-napi');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const sharp = require('sharp');
const { SelectorEngine } = require('../core/SelectorEngine');
const WorkflowParser = require('../core/WorkflowParser');

class AdvancedRecorder extends EventEmitter {
    constructor(options = {}) {
        super();

        this.options = {
            captureScreenshots: true,
            captureMultipleSelectors: true,
            captureUIAutomation: true,
            smartWaitDetection: true,
            mergeKeystrokes: true,
            recordHoverEvents: false,
            recordScrollEvents: true,
            captureRegionSize: 100,
            anchorSearchRadius: 200,
            ...options
        };

        this.workflow = {
            id: uuidv4(),
            name: 'Recorded Workflow',
            description: 'Workflow recorded by RPA Studio',
            version: '1.0.0',
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            variables: {},
            arguments: {},
            imports: [],
            mainSequence: {
                type: 'Sequence',
                name: 'Main Sequence',
                activities: []
            }
        };

        this.isRecording = false;
        this.isPaused = false;
        this.lastEventTime = Date.now();
        this.keyBuffer = [];
        this.currentApplication = null;
        this.captureDir = null;
        this.selectorEngine = new SelectorEngine();
        this.workflowParser = new WorkflowParser();
        this.lastTargetSelectors = null;

        // Recording statistics
        this.stats = {
            startTime: null,
            endTime: null,
            totalActivities: 0,
            applications: new Set(),
            errors: []
        };
    }

    async start() {
        if (this.isRecording) {
            throw new Error('Recording already in progress');
        }

        this.isRecording = true;
        this.stats.startTime = new Date();

        // Create capture directory
        this.captureDir = path.join(process.cwd(), 'captures', `recording_${Date.now()}`);
        await fs.mkdir(this.captureDir, { recursive: true });

        // Set up event listeners
        this.setupEventListeners();

        // Start recording
        iohook.start();

        this.emit('recording:started', {
            workflowId: this.workflow.id,
            timestamp: new Date()
        });

        console.log('Advanced recording started');
    }

    async stop() {
        if (!this.isRecording) {
            throw new Error('No recording in progress');
        }

        // Process any pending keystrokes
        await this.flushKeyBuffer();

        this.isRecording = false;
        this.stats.endTime = new Date();

        // Stop event listeners
        iohook.stop();
        this.removeEventListeners();

        // Post-process workflow
        await this.postProcessWorkflow();

        this.emit('recording:stopped', {
            workflowId: this.workflow.id,
            stats: this.stats,
            timestamp: new Date()
        });

        console.log('Advanced recording stopped');

        return this.workflow;
    }

    pause() {
        this.isPaused = true;
        this.emit('recording:paused');
    }

    resume() {
        this.isPaused = false;
        this.emit('recording:resumed');
    }

    setupEventListeners() {
        // Mouse events
        iohook.on('mousedown', this.handleMouseDown.bind(this));
        iohook.on('mouseup', this.handleMouseUp.bind(this));
        iohook.on('mousemove', this.handleMouseMove.bind(this));
        iohook.on('wheel', this.handleMouseWheel.bind(this));

        // Keyboard events
        iohook.on('keydown', this.handleKeyDown.bind(this));
        iohook.on('keyup', this.handleKeyUp.bind(this));
    }

    removeEventListeners() {
        iohook.removeAllListeners();
    }

    async handleMouseDown(event) {
        if (!this.isRecording || this.isPaused) return;

        try {
            const activity = await this.createClickActivity(event);
            if (activity) {
                await this.addActivity(activity);
            }
        } catch (error) {
            this.handleError('MouseDown', error);
        }
    }

    async handleMouseUp(event) {
        // Used for drag detection
    }

    async handleMouseMove(event) {
        if (!this.isRecording || this.isPaused) return;

        if (this.options.recordHoverEvents) {
            // Implement hover detection logic
        }
    }

    async handleMouseWheel(event) {
        if (!this.isRecording || this.isPaused) return;

        if (this.options.recordScrollEvents) {
            try {
                const activity = {
                    type: 'MouseScroll',
                    name: 'Scroll',
                    properties: {
                        direction: event.direction,
                        amount: event.rotation,
                        x: event.x,
                        y: event.y
                    }
                };

                await this.addActivity(activity);
            } catch (error) {
                this.handleError('MouseWheel', error);
            }
        }
    }

    async handleKeyDown(event) {
        if (!this.isRecording || this.isPaused) return;

        try {
            // Check for special keys
            const specialKey = this.getSpecialKey(event);
            if (specialKey) {
                await this.flushKeyBuffer();
                await this.createKeyboardShortcutActivity(event);
            } else {
                // Add to key buffer for text input
                const char = this.getCharFromKeycode(event);
                if (char) {
                    this.keyBuffer.push({
                        char,
                        timestamp: Date.now(),
                        event
                    });

                    // Auto-flush buffer after delay
                    setTimeout(() => this.flushKeyBuffer(), 500);
                }
            }
        } catch (error) {
            this.handleError('KeyDown', error);
        }
    }

    async handleKeyUp(event) {
        // Used for key combination detection
    }

    async createClickActivity(event) {
        const delay = this.calculateDelay();
        const activeWindow = await getActiveWindow();
        const windowInfo = await this.getWindowInfo(activeWindow);

        // Capture multiple selectors
        const selectors = await this.captureSelectors(event);
        this.lastTargetSelectors = selectors; // remember for next TypeInto

        const activity = {
            id: uuidv4(),
            type: 'Click',
            name: `Click on ${windowInfo.title}`,
            properties: {
                selectors,
                button: event.button === 2 ? 'right' : 'left',
                clickType: 'single',
                delayBefore: delay,
                windowInfo
            }
        };

        // Capture screenshot if enabled
        if (this.options.captureScreenshots) {
            activity.properties.screenshot = await this.captureScreenshot(event);
        }

        return activity;
    }

    async captureSelectors(event) {
        const selectors = [];

        // 1. Coordinate selector (fallback)
        selectors.push({
            strategy: 'coordinates',
            x: event.x,
            y: event.y
        });

        // 2. Image selector
        if (this.options.captureScreenshots) {
            const imagePath = await this.captureElementImage(event);
            if (imagePath) {
                selectors.push({
                    strategy: 'image',
                    imagePath,
                    confidence: 0.8
                });
            }
        }

        // 3. UI Automation selector
        if (this.options.captureUIAutomation && process.platform === 'win32') {
            const uiSelector = await this.captureUIAutomationSelector(event);
            if (uiSelector) {
                selectors.push(uiSelector);
            }
        }

        // 4. Anchor selector
        if (this.options.captureMultipleSelectors) {
            const anchorSelector = await this.captureAnchorSelector(event);
            if (anchorSelector) {
                selectors.push(anchorSelector);
            }
        }

        // 5. OCR selector (if text is detected)
        const ocrSelector = await this.captureOCRSelector(event);
        if (ocrSelector) {
            selectors.push(ocrSelector);
        }

        return selectors;
    }

    async captureElementImage(event) {
        try {
            const captureSize = this.options.captureRegionSize;
            const halfSize = Math.floor(captureSize / 2);

            const screenWidth = await screen.width();
            const screenHeight = await screen.height();

            // Calculate capture region
            let left = Math.max(0, event.x - halfSize);
            let top = Math.max(0, event.y - halfSize);
            let width = captureSize;
            let height = captureSize;

            // Adjust for screen boundaries
            if (left + width > screenWidth) {
                left = screenWidth - width;
            }
            if (top + height > screenHeight) {
                top = screenHeight - height;
            }

            const region = new Region(left, top, width, height);
            const imageName = `element_${Date.now()}.png`;
            const outPath = path.join(this.captureDir, imageName);

            const tmpPath = await screen.capture('element', region);
            await sharp(tmpPath)
                .resize(captureSize, captureSize, { fit: 'contain' })
                .toFile(outPath);

            return outPath;

        } catch (error) {
            console.error('Failed to capture element image:', error);
            return null;
        }
    }

    async captureUIAutomationSelector(event) {
        // Platform-specific UI automation selector capture
        // This would integrate with Windows UI Automation API
        try {
            // Simplified example - real implementation would use native bindings
            return {
                strategy: 'uiAutomation',
                windowTitle: await this.getWindowTitle(),
                className: 'Button', // Would be detected dynamically
                automationId: null,
                name: null
            };
        } catch (error) {
            return null;
        }
    }

    async captureAnchorSelector(event) {
        try {
            const anchors = [];
            const searchRadius = this.options.anchorSearchRadius;

            // Find stable elements around the target
            // This is a simplified implementation
            const potentialAnchors = [
                { x: event.x - searchRadius, y: event.y }, // Left
                { x: event.x + searchRadius, y: event.y }, // Right
                { x: event.x, y: event.y - searchRadius }, // Above
                { x: event.x, y: event.y + searchRadius }  // Below
            ];

            for (const anchor of potentialAnchors) {
                if (anchor.x >= 0 && anchor.y >= 0) {
                    const anchorImage = await this.captureElementImage(anchor);
                    if (anchorImage) {
                        anchors.push({
                            strategy: 'image',
                            imagePath: anchorImage,
                            position: this.getRelativePosition(event, anchor)
                        });
                    }
                }
            }

            if (anchors.length > 0) {
                return {
                    strategy: 'anchor',
                    target: {
                        strategy: 'coordinates',
                        x: event.x,
                        y: event.y
                    },
                    anchors
                };
            }

            return null;

        } catch (error) {
            return null;
        }
    }

    async captureOCRSelector(event) {
        try {
            // Capture region around click point
            const region = new Region(
                event.x - 100,
                event.y - 50,
                200,
                100
            );

            const screenshot = await screen.capture('ocr_temp', region);

            // Perform OCR
            const Tesseract = require('tesseract.js');
            const result = await Tesseract.recognize(screenshot, 'eng');

            // Find closest text to click point
            let closestText = null;
            let minDistance = Infinity;

            for (const word of result.data.words) {
                const wordCenterX = word.bbox.x0 + (word.bbox.x1 - word.bbox.x0) / 2;
                const wordCenterY = word.bbox.y0 + (word.bbox.y1 - word.bbox.y0) / 2;

                const distance = Math.sqrt(
                    Math.pow(100 - wordCenterX, 2) +
                    Math.pow(50 - wordCenterY, 2)
                );

                if (distance < minDistance && word.text.trim().length > 0) {
                    minDistance = distance;
                    closestText = word.text.trim();
                }
            }

            // Clean up
            await fs.unlink(screenshot).catch(() => { });

            if (closestText) {
                return {
                    strategy: 'ocr',
                    text: closestText,
                    searchRegion: {
                        x: region.left,
                        y: region.top,
                        width: region.width,
                        height: region.height
                    }
                };
            }

            return null;

        } catch (error) {
            return null;
        }
    }

    async captureScreenshot(event) {
        try {
            const screenshotName = `screenshot_${Date.now()}.png`;
            const outPath = path.join(this.captureDir, screenshotName);

            // Capture full screen with highlight (use temp path from nut-tree)
            const screenWidth = await screen.width();
            const screenHeight = await screen.height();
            const fullRegion = new Region(0, 0, screenWidth, screenHeight);

            const tmpPath = await screen.capture('full', fullRegion);

            // Add highlight marker at click position and write to our folder
            await sharp(tmpPath)
                .composite([{
                    input: Buffer.from(
                        `<svg width="30" height="30">\n                            <circle cx="15" cy="15" r="10" fill="red" opacity="0.5"/>\n                            <circle cx="15" cy="15" r="2" fill="red"/>\n                        </svg>`
                    ),
                    left: event.x - 15,
                    top: event.y - 15
                }])
                .toFile(outPath);

            return outPath;

        } catch (error) {
            console.error('Failed to capture screenshot:', error);
            return null;
        }
    }

    async flushKeyBuffer() {
        if (this.keyBuffer.length === 0) return;

        const text = this.keyBuffer.map(k => k.char).join('');
        const delay = this.calculateDelay();

        const activity = {
            id: uuidv4(),
            type: 'TypeInto',
            name: `Type "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`,
            properties: {
                text,
                delayBetweenKeys: 0,
                delayBefore: delay,
                emptyField: false,
                clickBeforeTyping: true,
                selectors: this.lastTargetSelectors || undefined
            }
        };

        await this.addActivity(activity);
        this.keyBuffer = [];
    }

    async createKeyboardShortcutActivity(event) {
        const shortcut = this.buildShortcutString(event);
        const delay = this.calculateDelay();

        const activity = {
            id: uuidv4(),
            type: 'KeyboardShortcut',
            name: `Keyboard Shortcut: ${shortcut}`,
            properties: {
                shortcut,
                delayBefore: delay
            }
        };

        await this.addActivity(activity);
    }

    async addActivity(activity) {
        // Add to workflow (ensure structure exists)
        if (!this.workflow.mainSequence) {
            this.workflow.mainSequence = { type: 'Sequence', name: 'Main Sequence', activities: [] };
        }
        if (!Array.isArray(this.workflow.mainSequence.activities)) {
            this.workflow.mainSequence.activities = [];
        }
        this.workflow.mainSequence.activities.push(activity);
        this.stats.totalActivities++;

        // Update last event time
        this.lastEventTime = Date.now();

        // Emit event
        this.emit('activity:recorded', activity);

        // Auto-save workflow periodically
        if (this.stats.totalActivities % 10 === 0) {
            await this.saveWorkflow();
        }
    }

    calculateDelay() {
        const now = Date.now();
        const delay = now - this.lastEventTime;
        this.lastEventTime = now;

        // Smart wait detection
        if (this.options.smartWaitDetection && delay > 1000) {
            return delay;
        }

        return 0;
    }

    async getWindowInfo(window) {
        try {
            const title = await window.getTitle();
            const region = await window.getRegion();

            this.stats.applications.add(title);

            return {
                title,
                region: {
                    x: region.left,
                    y: region.top,
                    width: region.width,
                    height: region.height
                },
                process: process.platform === 'win32' ? await this.getProcessName() : null
            };
        } catch (error) {
            return {
                title: 'Unknown',
                region: null,
                process: null
            };
        }
    }

    async getWindowTitle() {
        try {
            const window = await getActiveWindow();
            return await window.getTitle();
        } catch {
            return 'Unknown';
        }
    }

    getRelativePosition(target, anchor) {
        const dx = target.x - anchor.x;
        const dy = target.y - anchor.y;

        if (Math.abs(dx) > Math.abs(dy)) {
            return dx > 0 ? 'right' : 'left';
        } else {
            return dy > 0 ? 'below' : 'above';
        }
    }

    getSpecialKey(event) {
        // Only non-modifier keys should be treated as special here
        const specialKeys = {
            28: 'enter',
            1: 'escape',
            14: 'backspace',
            15: 'tab',
            // do NOT map space here so it is captured as text
            // do NOT map ctrl/shift/alt/win here; we handle as modifiers
        };

        return specialKeys[event.keycode] || null;
    }

    getCharFromKeycode(event) {
        // This is a simplified mapping - real implementation would be more complex
        if (event.keychar && event.keychar !== 0) {
            return String.fromCharCode(event.keychar);
        }
        return null;
    }

    buildShortcutString(event) {
        const parts = [];

        if (event.ctrlKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');
        if (event.metaKey) parts.push('win');

        // Prefer printable character as the main key; fallback to non-modifier special
        const printable = this.getCharFromKeycode(event);
        const special = this.getSpecialKey(event);
        const base = printable ? printable.toLowerCase() : (special || '');
        if (base && !['ctrl', 'shift', 'alt', 'win'].includes(base)) {
            parts.push(base);
        }

        return parts.join('+');
    }

    async postProcessWorkflow() {
        // Optimize workflow
        this.optimizeActivities();

        // Skip TryCatch wrapping to keep engine minimal
        this.addErrorHandling();

        // Update metadata
        this.workflow.modifiedAt = new Date().toISOString();

        // Save final workflow
        await this.saveWorkflow();
    }

    optimizeActivities() {
        // Merge consecutive TypeInto activities
        const optimized = [];
        let i = 0;

        while (i < this.workflow.mainSequence.activities.length) {
            const current = this.workflow.mainSequence.activities[i];

            if (current.type === 'TypeInto' && i + 1 < this.workflow.mainSequence.activities.length) {
                const next = this.workflow.mainSequence.activities[i + 1];

                if (next.type === 'TypeInto' &&
                    next.properties.delayBefore < 100) {
                    // Merge
                    current.properties.text += next.properties.text;
                    current.name = `Type "${current.properties.text.substring(0, 20)}${current.properties.text.length > 20 ? '...' : ''}"`;
                    i += 2;
                    continue;
                }
            }

            optimized.push(current);
            i++;
        }

        this.workflow.mainSequence.activities = optimized;
    }

    addErrorHandling() {
        // intentionally empty for now (no TryCatch to avoid unsupported activity)
        return;
    }

    async saveWorkflow() {
        const workflowPath = path.join(this.captureDir, 'workflow.rpa.xml');
        await this.workflowParser.saveWorkflow(this.workflow, workflowPath);

        // Also save as JSON for debugging
        const jsonPath = path.join(this.captureDir, 'workflow.json');
        await fs.writeFile(jsonPath, JSON.stringify(this.workflow, null, 2));
    }

    handleError(source, error) {
        console.error(`Recording error in ${source}:`, error);
        this.stats.errors.push({
            source,
            message: error.message,
            timestamp: new Date()
        });

        this.emit('recording:error', {
            source,
            error: error.message
        });
    }

    async getProcessName() {
        // Windows-specific process name detection
        // Would use native bindings in production
        return 'unknown.exe';
    }
}

module.exports = AdvancedRecorder;