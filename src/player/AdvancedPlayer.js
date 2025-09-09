// src/player/AdvancedPlayer.js
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const { SelectorEngine } = require('../core/SelectorEngine');
const WorkflowEngine = require('../core/WorkflowEngine');
const WorkflowParser = require('../core/WorkflowParser');

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'player.log' }),
        new winston.transports.Console()
    ]
});

class AdvancedPlayer extends EventEmitter {
    constructor(options = {}) {
        super();

        this.options = {
            defaultTimeout: 30000,
            defaultRetryCount: 3,
            defaultRetryInterval: 1000,
            slowMotion: 0,
            highlightElements: true,
            takeScreenshotsOnError: true,
            continueOnError: false,
            parallel: false,
            ...options
        };

        this.engine = new WorkflowEngine();
        this.parser = new WorkflowParser();
        this.selectorEngine = new SelectorEngine();

        this.executionId = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.stats = null;

        this.setupEngineListeners();
    }

    setupEngineListeners() {
        // Forward engine events
        this.engine.on('workflow:start', (data) => {
            this.emit('execution:start', data);
        });

        this.engine.on('workflow:complete', (data) => {
            this.emit('execution:complete', data);
        });

        this.engine.on('workflow:error', (data) => {
            this.emit('execution:error', data);
        });

        this.engine.on('activity:start', (data) => {
            this.emit('activity:start', data);
        });

        this.engine.on('activity:complete', (data) => {
            this.emit('activity:complete', data);
        });

        this.engine.on('activity:error', (data) => {
            this.emit('activity:error', data);
        });
    }

    async play(workflow, options = {}) {
        if (this.isPlaying) {
            throw new Error('Player already running');
        }

        try {
            this.isPlaying = true;
            this.executionId = uuidv4();
            this.stats = {
                executionId: this.executionId,
                startTime: new Date(),
                endTime: null,
                totalActivities: 0,
                successfulActivities: 0,
                failedActivities: 0,
                errors: [],
                screenshots: []
            };

            logger.info(`Starting workflow execution: ${this.executionId}`);

            // Parse workflow if it's a file path
            let workflowObj = workflow;
            if (typeof workflow === 'string') {
                workflowObj = await this.parser.parseWorkflow(workflow);
            }

            // Validate workflow
            this.validateWorkflow(workflowObj);

            // Execute workflow
            const result = await this.engine.executeWorkflow(workflowObj, {
                ...this.options,
                ...options,
                executionId: this.executionId
            });

            this.stats.endTime = new Date();
            this.stats.duration = this.stats.endTime - this.stats.startTime;

            logger.info(`Workflow execution completed: ${this.executionId}`, {
                duration: this.stats.duration,
                success: result.success
            });

            return {
                executionId: this.executionId,
                result,
                stats: this.stats
            };

        } catch (error) {
            logger.error(`Workflow execution failed: ${this.executionId}`, error);

            this.stats.endTime = new Date();
            this.stats.duration = this.stats.endTime - this.stats.startTime;
            this.stats.errors.push({
                message: error.message,
                stack: error.stack,
                timestamp: new Date()
            });

            throw error;

        } finally {
            this.isPlaying = false;
        }
    }

    async playActivity(activity, options = {}) {
        const activityId = activity.id || uuidv4();
        const startTime = Date.now();

        try {
            logger.debug(`Executing activity: ${activity.type} (${activityId})`);

            this.stats.totalActivities++;

            // Apply retry logic
            const retryCount = activity.retryCount || this.options.defaultRetryCount;
            const retryInterval = activity.retryInterval || this.options.defaultRetryInterval;

            let lastError;
            for (let attempt = 0; attempt <= retryCount; attempt++) {
                try {
                    if (attempt > 0) {
                        logger.info(`Retrying activity ${activityId}, attempt ${attempt + 1}/${retryCount + 1}`);
                        await this.sleep(retryInterval);
                    }

                    // Execute activity based on type
                    const result = await this.executeActivityByType(activity);

                    this.stats.successfulActivities++;

                    logger.debug(`Activity completed: ${activity.type} (${activityId})`, {
                        duration: Date.now() - startTime,
                        attempt: attempt + 1
                    });

                    return result;

                } catch (error) {
                    lastError = error;
                    logger.warn(`Activity failed: ${activity.type} (${activityId})`, {
                        attempt: attempt + 1,
                        error: error.message
                    });

                    // Take screenshot on error if enabled
                    if (this.options.takeScreenshotsOnError) {
                        const screenshot = await this.takeErrorScreenshot(activity, error);
                        this.stats.screenshots.push(screenshot);
                    }
                }
            }

            // All retries failed
            this.stats.failedActivities++;
            this.stats.errors.push({
                activityId,
                activityType: activity.type,
                message: lastError.message,
                timestamp: new Date()
            });

            if (activity.continueOnError || this.options.continueOnError) {
                logger.error(`Activity failed after ${retryCount + 1} attempts, continuing: ${activityId}`);
                return null;
            } else {
                throw lastError;
            }

        } catch (error) {
            logger.error(`Activity execution failed: ${activity.type} (${activityId})`, error);
            throw error;
        }
    }

    async executeActivityByType(activity) {
        // Apply slow motion if configured
        if (this.options.slowMotion > 0) {
            await this.sleep(this.options.slowMotion);
        }

        switch (activity.type) {
            case 'Click':
                return await this.executeClick(activity);
            case 'TypeInto':
                return await this.executeTypeInto(activity);
            case 'GetText':
                return await this.executeGetText(activity);
            case 'SelectItem':
                return await this.executeSelectItem(activity);
            case 'Hover':
                return await this.executeHover(activity);
            case 'KeyboardShortcut':
                return await this.executeKeyboardShortcut(activity);
            case 'TakeScreenshot':
                return await this.executeTakeScreenshot(activity);
            case 'MouseScroll':
                return await this.executeMouseScroll(activity);
            case 'Delay':
                return await this.executeDelay(activity);
            default:
                throw new Error(`Unknown activity type: ${activity.type}`);
        }
    }

    async executeClick(activity) {
        const { selectors, button = 'left', clickType = 'single', delayBefore } = activity.properties;

        if (delayBefore) {
            await this.sleep(delayBefore);
        }

        // Find element using selector engine
        const element = await this.findElement(selectors);

        if (!element) {
            throw new Error('Element not found for click activity');
        }

        // Highlight element if enabled
        if (this.options.highlightElements) {
            await this.highlightElement(element);
        }

        // Perform click
        switch (clickType) {
            case 'single':
                await element.click(button);
                break;
            case 'double':
                await element.doubleClick();
                break;
            case 'right':
                await element.rightClick();
                break;
        }

        logger.info(`Clicked element`, {
            button,
            clickType,
            selector: selectors[0]
        });
    }

    async executeTypeInto(activity) {
        const {
            text,
            selectors,
            delayBetweenKeys = 0,
            delayBefore,
            emptyField = false,
            clickBeforeTyping = true,
            simulateTyping = true
        } = activity.properties;

        if (delayBefore) {
            await this.sleep(delayBefore);
        }

        const { keyboard, Key } = require("@nut-tree-fork/nut-js");

        // Normalize selectors
        let selArray = selectors;
        if (selectors && !Array.isArray(selectors)) {
            selArray = [selectors];
        }

        // Click on field if required
        if (clickBeforeTyping && selArray) {
            try {
                const element = await this.findElement(selArray);
                if (element) {
                    await element.click();
                    await this.sleep(150);
                }
            } catch (e) {
                logger.warn('TypeInto focus click failed; continuing to type', { error: e?.message });
            }
        }

        // Clear field if required
        if (emptyField) {
            await keyboard.pressKey(Key.LeftControl, Key.A);
            await keyboard.releaseKey(Key.LeftControl, Key.A);
            await keyboard.type(Key.Delete);
            await this.sleep(50);
        }

        // Type text
        if (simulateTyping) {
            for (const char of text) {
                await keyboard.type(char);
                if (delayBetweenKeys > 0) {
                    await this.sleep(delayBetweenKeys);
                }
            }
        } else {
            await keyboard.type(text);
        }

        logger.info(`Typed text: "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`);
    }

    async executeGetText(activity) {
        const { selectors, timeout = this.options.defaultTimeout } = activity.properties;

        const element = await this.findElement(selectors, { timeout });

        if (!element) {
            throw new Error('Element not found for get text activity');
        }

        // Use OCR to extract text
        const { screen, Region } = require("@nut-tree-fork/nut-js");
        const bounds = await element.getBounds();
        const region = new Region(bounds.x, bounds.y, bounds.width, bounds.height);

        const screenshot = await screen.capture('getText', region);

        // Perform OCR
        const Tesseract = require('tesseract.js');
        const result = await Tesseract.recognize(screenshot, 'eng');

        const text = result.data.text.trim();

        logger.info(`Extracted text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        return text;
    }

    async executeHover(activity) {
        const { selectors, duration = 0 } = activity.properties;

        const element = await this.findElement(selectors);

        if (!element) {
            throw new Error('Element not found for hover activity');
        }

        await element.hover();

        if (duration > 0) {
            await this.sleep(duration);
        }

        logger.info('Hovered over element');
    }

    async executeKeyboardShortcut(activity) {
        const { shortcut, delayBefore } = activity.properties;

        if (delayBefore) {
            await this.sleep(delayBefore);
        }

        const { keyboard, Key } = require("@nut-tree-fork/nut-js");

        // Parse shortcut string
        const keys = shortcut.toLowerCase().split('+').map(k => k.trim());
        const keyMap = {
            'ctrl': Key.LeftControl,
            'control': Key.LeftControl,
            'shift': Key.LeftShift,
            'alt': Key.LeftAlt,
            'win': Key.LeftSuper,
            'cmd': Key.LeftSuper,
            'enter': Key.Enter,
            'return': Key.Enter,
            'esc': Key.Escape,
            'escape': Key.Escape,
            'tab': Key.Tab,
            'space': Key.Space,
            'backspace': Key.Backspace,
            'delete': Key.Delete,
            'up': Key.Up,
            'down': Key.Down,
            'left': Key.Left,
            'right': Key.Right,
            'f1': Key.F1,
            'f2': Key.F2,
            'f3': Key.F3,
            'f4': Key.F4,
            'f5': Key.F5,
            // Add more key mappings
        };

        const pressKeys = [];
        const regularKeys = [];

        for (const key of keys) {
            if (keyMap[key]) {
                pressKeys.push(keyMap[key]);
            } else if (key.length === 1) {
                regularKeys.push(key);
            }
        }

        // Press modifier keys
        for (const key of pressKeys) {
            await keyboard.pressKey(key);
        }

        // Type regular keys
        for (const key of regularKeys) {
            await keyboard.type(key);
        }

        // Release modifier keys
        for (const key of pressKeys.reverse()) {
            await keyboard.releaseKey(key);
        }

        logger.info(`Executed keyboard shortcut: ${shortcut}`);
    }

    async executeTakeScreenshot(activity) {
        const { filename, region, fullScreen = true } = activity.properties;

        const { screen, Region } = require("@nut-tree-fork/nut-js");

        let captureRegion;
        if (fullScreen) {
            const width = await screen.width();
            const height = await screen.height();
            captureRegion = new Region(0, 0, width, height);
        } else if (region) {
            captureRegion = new Region(region.x, region.y, region.width, region.height);
        }

        const screenshotPath = await screen.capture(filename || `screenshot_${Date.now()}`, captureRegion);

        logger.info(`Screenshot taken: ${screenshotPath}`);

        return screenshotPath;
    }

    async executeMouseScroll(activity) {
        const { direction, amount, x, y } = activity.properties;

        const { mouse, Point } = require("@nut-tree-fork/nut-js");

        if (x !== undefined && y !== undefined) {
            await mouse.setPosition(new Point(x, y));
        }

        // Simulate scroll
        const scrollAmount = amount || 3;
        for (let i = 0; i < Math.abs(scrollAmount); i++) {
            await mouse.scrollDown(direction === 'down' ? 1 : -1);
            await this.sleep(50);
        }

        logger.info(`Scrolled ${direction} by ${scrollAmount}`);
    }

    async executeDelay(activity) {
        const { duration } = activity.properties;

        await this.sleep(duration);

        logger.info(`Delayed for ${duration}ms`);
    }

    async executeSelectItem(activity) {
        const { selectors, value, byIndex, byText } = activity.properties;

        const element = await this.findElement(selectors);

        if (!element) {
            throw new Error('Element not found for select item activity');
        }

        // Click to open dropdown
        await element.click();
        await this.sleep(200);

        const { keyboard, Key } = require("@nut-tree-fork/nut-js");

        if (byIndex !== undefined) {
            // Navigate by index
            for (let i = 0; i < byIndex; i++) {
                await keyboard.type(Key.Down);
                await this.sleep(100);
            }
            await keyboard.type(Key.Enter);
        } else if (byText || value) {
            // Type to search
            await keyboard.type(byText || value);
            await this.sleep(500);
            await keyboard.type(Key.Enter);
        }

        logger.info(`Selected item: ${value || byText || `index ${byIndex}`}`);
    }

    async findElement(selectors, options = {}) {
        if (!selectors || (Array.isArray(selectors) && selectors.length === 0)) {
            throw new Error('No selectors provided');
        }

        // Normalize to array and reorder to prefer robust strategies
        let selArray = selectors;
        if (!Array.isArray(selArray)) selArray = [selArray];
        const priority = { image: 0, anchor: 1, ocr: 2, uiAutomation: 3, coordinates: 9 };
        selArray = selArray.slice().sort((a, b) => (priority[a?.strategy] ?? 5) - (priority[b?.strategy] ?? 5));

        const timeout = options.timeout || this.options.defaultTimeout;
        const startTime = Date.now();

        for (const selector of selArray) {
            try {
                logger.debug(`Trying selector strategy: ${selector.strategy}`);
                const remaining = Math.max(0, timeout - (Date.now() - startTime));
                const element = await this.selectorEngine.waitForElement(selector, {
                    timeout: remaining,
                    condition: options.condition || 'exists'
                });
                if (element) {
                    logger.debug(`Element found with strategy: ${selector.strategy}`);
                    return element;
                }
            } catch (error) {
                logger.debug(`Selector strategy failed: ${selector.strategy}`, error.message);
                continue;
            }
        }

        throw new Error(`Element not found after trying ${selArray.length} selector strategies`);
    }

    async highlightElement(element) {
        try {
            const { screen } = require("@nut-tree-fork/nut-js");
            screen.config.autoHighlight = true;
            screen.config.highlightDurationMs = 500;
            screen.config.highlightOpacity = 0.5;

            const bounds = await element.getBounds();
            await screen.highlight(bounds);

        } catch (error) {
            // Ignore highlight errors
            logger.debug('Failed to highlight element', error.message);
        }
    }

    async takeErrorScreenshot(activity, error) {
        try {
            const { screen } = require("@nut-tree-fork/nut-js");
            const timestamp = Date.now();
            const filename = `error_${activity.type}_${timestamp}`;

            const screenshotPath = await screen.capture(filename);

            return {
                path: screenshotPath,
                activityId: activity.id,
                activityType: activity.type,
                error: error.message,
                timestamp: new Date()
            };

        } catch (screenshotError) {
            logger.error('Failed to take error screenshot', screenshotError);
            return null;
        }
    }

    validateWorkflow(workflow) {
        if (!workflow) {
            throw new Error('Workflow is required');
        }

        if (!workflow.mainSequence) {
            throw new Error('Workflow must have a main sequence');
        }

        // Validate workflow structure
        this.validateActivity(workflow.mainSequence);
    }

    validateActivity(activity) {
        if (!activity) {
            throw new Error('Activity is null');
        }

        if (!activity.type) {
            throw new Error('Activity must have a type');
        }

        // Validate child activities
        if (activity.activities) {
            for (const child of activity.activities) {
                this.validateActivity(child);
            }
        }

        if (activity.then) {
            this.validateActivity(activity.then);
        }

        if (activity.else) {
            this.validateActivity(activity.else);
        }

        if (activity.body) {
            this.validateActivity(activity.body);
        }
    }

    pause() {
        this.isPaused = true;
        this.engine.pause();
        this.emit('execution:paused');
    }

    resume() {
        this.isPaused = false;
        this.engine.resume();
        this.emit('execution:resumed');
    }

    stop() {
        this.engine.stop();
        this.isPlaying = false;
        this.emit('execution:stopped');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getExecutionState() {
        return {
            executionId: this.executionId,
            isPlaying: this.isPlaying,
            isPaused: this.isPaused,
            stats: this.stats,
            engineState: this.engine.getExecutionState()
        };
    }
}

module.exports = AdvancedPlayer;