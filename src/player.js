// src/player.js
const { mouse, screen, Point, Button, keyboard, Key } = require("@nut-tree-fork/nut-js");
const fs = require('fs');

screen.config.confidence = 0.7;
screen.config.autoHighlight = true;
screen.config.highlightDurationMs = 500;

class Player {
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async play(workflow, onInfo) {
        const steps = Array.isArray(workflow?.steps) ? workflow.steps : workflow;
        console.log('Player started.');
        for (const step of steps) {
            if (step.delayMs) await this._sleep(step.delayMs);
            try {
                if (step.type === 'click') {
                    let targetLocation;
                    try {
                        const imgPath = step.selectors.imagePath;
                        if (!imgPath || !fs.existsSync(imgPath)) {
                            throw new Error(`Image file missing: ${imgPath}`);
                        }
                        targetLocation = await screen.find(imgPath, { timeout: 10000 });
                        console.log('Found element with Computer Vision.');
                    } catch (err) {
                        console.warn('Image search failed. Falling back to coordinates.', err?.message || err);
                        if (typeof onInfo === 'function') {
                            onInfo({ kind: 'image-search-failed', step });
                        }
                    }

                    if (!targetLocation) {
                        const coords = step.selectors.coordinates;
                        targetLocation = new Point(coords.x, coords.y);
                    }

                    await mouse.setPosition(targetLocation);
                    const isRight = step.mouse?.button === 'right';
                    await mouse.click(isRight ? Button.RIGHT : Button.LEFT);
                } else if (step.type === 'key') {
                    if (typeof step.text === 'string' && step.text.length > 0) {
                        for (const ch of step.text) {
                            await keyboard.type(ch);
                        }
                    }
                }
            } catch (error) {
                console.error('Error executing step:', error);
                return;
            }
        }
        console.log('Player finished.');
    }
}

module.exports = Player;