// src/recorder.js
const { screen, getActiveWindow, Region } = require("@nut-tree-fork/nut-js");
const { uIOhook: iohook } = require('uiohook-napi');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

class Recorder {
    constructor() {
        this.steps = [];
        this.isRecording = false;
        this._lastEventTs = 0;
    }

    start() {
        this.steps = [];
        this.isRecording = true;
        this._lastEventTs = Date.now();
        iohook.on('mousedown', this._handleMouseDown.bind(this));
        iohook.on('keydown', this._handleKeyDown.bind(this));
        iohook.start();
        console.log('Recorder started.');
    }

    stop() {
        iohook.stop();
        iohook.removeAllListeners('mousedown');
        iohook.removeAllListeners('keydown');
        this.isRecording = false;
        console.log('Recorder stopped.');
        // Persist images into a stable folder inside the project during development
        try {
            const projectCapturesDir = path.join(app.getAppPath(), 'captures');
            try { fs.mkdirSync(projectCapturesDir, { recursive: true }); } catch { }
            for (const step of this.steps) {
                const imagePath = step?.selectors?.imagePath;
                if (!imagePath) continue;
                try {
                    if (fs.existsSync(imagePath)) {
                        const baseName = path.basename(imagePath).endsWith('.png')
                            ? path.basename(imagePath)
                            : `${path.basename(imagePath)}.png`;
                        const destPath = path.join(projectCapturesDir, baseName);
                        try { fs.copyFileSync(imagePath, destPath); } catch { }
                        if (fs.existsSync(destPath)) {
                            step.selectors.imagePath = destPath;
                            console.log('Copied capture to project:', destPath);
                        } else {
                            console.warn('Failed to copy capture to project folder:', imagePath);
                        }
                    } else {
                        console.warn('Temp capture does not exist to copy:', imagePath);
                    }
                } catch (copyErr) {
                    console.error('Error while copying capture:', copyErr);
                }
            }
        } catch (persistErr) {
            console.error('Failed to persist captures to project folder:', persistErr);
        }

        return {
            version: 1,
            createdAt: new Date().toISOString(),
            platform: process.platform,
            steps: this.steps,
        };
    }

    _computeDelayReset() {
        const now = Date.now();
        const delayMs = Math.max(0, now - this._lastEventTs);
        this._lastEventTs = now;
        return delayMs;
    }

    async _handleMouseDown(event) {
        if (!this.isRecording) return;
        try {
            const delayMs = this._computeDelayReset();
            const activeWindow = await getActiveWindow();
            const windowTitle = await activeWindow.getTitle();

            const imageBase = `step-${Date.now()}(${event.x}, ${event.y}, 50, 50)`;

            const screenWidth = await screen.width();
            const screenHeight = await screen.height();
            const captureWidth = 50;
            const captureHeight = 50;

            let left = Math.max(0, event.x - Math.round(captureWidth / 2));
            let top = Math.max(0, event.y - Math.round(captureHeight / 2));

            if (left + captureWidth > screenWidth) {
                left = screenWidth - captureWidth;
            }
            if (top + captureHeight > screenHeight) {
                top = screenHeight - captureHeight;
            }

            const region = new Region(left, top, captureWidth, captureHeight);
            const tempCapturedPath = await screen.capture(imageBase, region);
            const imagePath = tempCapturedPath;
            if (!fs.existsSync(imagePath)) {
                console.warn('Image file not found after capture (temp):', imagePath);
            } else {
                console.log('Saved capture (temp):', imagePath);
            }

            const step = {
                type: 'click',
                delayMs,
                targetAppTitle: windowTitle,
                selectors: {
                    imagePath,
                    coordinates: { x: event.x, y: event.y },
                },
                mouse: {
                    button: event.button === 2 ? 'right' : 'left',
                },
            };

            this.steps.push(step);
            console.log('Click step added:', step);
        } catch (error) {
            console.error('Error capturing click step:', error);
        }
    }

    async _handleKeyDown(event) {
        if (!this.isRecording) return;
        try {
            const delayMs = this._computeDelayReset();
            const activeWindow = await getActiveWindow();
            const windowTitle = await activeWindow.getTitle();

            const charCode = event.keychar || event.keycharCode || null;
            const printable = typeof charCode === 'number' && charCode >= 32 && charCode <= 126;
            if (!printable) {
                return; // Skip non-printable keys for now
            }
            const text = String.fromCharCode(charCode);
            const step = {
                type: 'key',
                delayMs,
                targetAppTitle: windowTitle,
                text,
            };
            this.steps.push(step);
            console.log('Key step added:', step);
        } catch (error) {
            console.error('Error capturing key step:', error);
        }
    }
}

module.exports = Recorder;