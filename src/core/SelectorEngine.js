// src/core/SelectorEngine.js
const { screen, Region, Point, Image } = require("@nut-tree-fork/nut-js");
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

class SelectorEngine {
    constructor() {
        this.strategies = new Map();
        this.cache = new Map();

        // Register default selector strategies
        this.registerStrategy('image', new ImageSelector());
        this.registerStrategy('coordinates', new CoordinateSelector());
        this.registerStrategy('ocr', new OCRSelector());
        this.registerStrategy('uiAutomation', new UIAutomationSelector());
        this.registerStrategy('relative', new RelativeSelector());
        this.registerStrategy('anchor', new AnchorSelector());
    }

    registerStrategy(name, strategy) {
        this.strategies.set(name, strategy);
    }

    async findElement(selector) {
        const { strategy = 'auto', ...params } = selector;

        // Auto-detect best strategy
        if (strategy === 'auto') {
            return await this.autoFind(params);
        }

        // Use specific strategy
        const selectorStrategy = this.strategies.get(strategy);
        if (!selectorStrategy) {
            throw new Error(`Unknown selector strategy: ${strategy}`);
        }

        return await selectorStrategy.find(params);
    }

    async autoFind(params) {
        // Try strategies in order of reliability
        const strategiesToTry = [];

        if (params.uiPath) {
            strategiesToTry.push('uiAutomation');
        }

        if (params.imagePath || params.imageData) {
            strategiesToTry.push('image');
        }

        if (params.text) {
            strategiesToTry.push('ocr');
        }

        if (params.anchorSelector) {
            strategiesToTry.push('anchor');
        }

        if (params.relativeSelector) {
            strategiesToTry.push('relative');
        }

        if (params.x !== undefined && params.y !== undefined) {
            strategiesToTry.push('coordinates');
        }

        // Try each strategy
        for (const strategy of strategiesToTry) {
            try {
                const result = await this.findElement({
                    ...params,
                    strategy
                });

                if (result) {
                    return result;
                }
            } catch (error) {
                // Continue to next strategy
                console.debug(`Strategy ${strategy} failed:`, error.message);
            }
        }

        throw new Error('Element not found with any strategy');
    }

    async waitForElement(selector, options = {}) {
        const {
            timeout = 30000,
            interval = 500,
            condition = 'exists'
        } = options;

        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            try {
                const element = await this.findElement(selector);

                if (condition === 'exists' && element) {
                    return element;
                }

                if (condition === 'visible' && element && await element.isVisible()) {
                    return element;
                }

                if (condition === 'enabled' && element && await element.isEnabled()) {
                    return element;
                }

            } catch (error) {
                // Element not found, continue waiting
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error(`Timeout waiting for element: ${JSON.stringify(selector)}`);
    }

    async captureElement(element, options = {}) {
        const { padding = 10 } = options;

        const bounds = await element.getBounds();
        const region = new Region(
            bounds.x - padding,
            bounds.y - padding,
            bounds.width + (padding * 2),
            bounds.height + (padding * 2)
        );

        return await screen.capture('element', region);
    }
}

// Image-based selector
class ImageSelector {
    async find(params) {
        const { imagePath, imageData, confidence = 0.8, searchRegion } = params;

        try {
            // Configure screen settings
            screen.config.confidence = confidence;
            screen.config.autoHighlight = true;
            screen.config.highlightDurationMs = 200;

            let searchArea = searchRegion;
            if (searchRegion) {
                searchArea = new Region(
                    searchRegion.x,
                    searchRegion.y,
                    searchRegion.width,
                    searchRegion.height
                );
            }

            // Find image on screen
            let result;
            if (imagePath) {
                const img = await Image.fromFile(imagePath);
                result = await screen.find(img, {
                    searchRegion: searchArea,
                    confidence
                });
            } else if (imageData) {
                // Create temporary file from image data
                const tempPath = path.join(require('os').tmpdir(), `temp_${Date.now()}.png`);
                await fs.writeFile(tempPath, Buffer.from(imageData, 'base64'));
                const img = await Image.fromFile(tempPath);
                result = await screen.find(img, {
                    searchRegion: searchArea,
                    confidence
                });
                await fs.unlink(tempPath);
            }

            if (result) {
                return new DesktopElement(result);
            }

            return null;

        } catch (error) {
            console.error('Image selector failed:', error);
            return null;
        }
    }
}

// Coordinate-based selector
class CoordinateSelector {
    async find(params) {
        const { x, y } = params;

        if (x === undefined || y === undefined) {
            throw new Error('Coordinates x and y are required');
        }

        const point = new Point(x, y);
        return new DesktopElement(point);
    }
}

// OCR-based selector
class OCRSelector {
    async find(params) {
        const { text, searchRegion, fuzzy = false } = params;

        try {
            // Take screenshot of search region
            let region = searchRegion;
            if (!region) {
                const width = await screen.width();
                const height = await screen.height();
                region = new Region(0, 0, width, height);
            }

            const screenshot = await screen.capture('ocr', region);

            // Perform OCR using Tesseract.js or similar
            const Tesseract = require('tesseract.js');
            const result = await Tesseract.recognize(screenshot, 'eng', {
                logger: m => console.debug(m)
            });

            // Find text in OCR results
            const words = result.data.words;

            for (const word of words) {
                const match = fuzzy
                    ? word.text.toLowerCase().includes(text.toLowerCase())
                    : word.text === text;

                if (match) {
                    const centerX = word.bbox.x0 + (word.bbox.x1 - word.bbox.x0) / 2;
                    const centerY = word.bbox.y0 + (word.bbox.y1 - word.bbox.y0) / 2;

                    return new DesktopElement(new Point(
                        region.left + centerX,
                        region.top + centerY
                    ));
                }
            }

            return null;

        } catch (error) {
            console.error('OCR selector failed:', error);
            return null;
        }
    }
}

// UI Automation selector (platform-specific)
class UIAutomationSelector {
    async find(params) {
        const { uiPath, windowTitle, className, controlType } = params;

        try {
            if (process.platform === 'win32') {
                return await this.findWindows(params);
            } else if (process.platform === 'darwin') {
                return await this.findMacOS(params);
            } else {
                return await this.findLinux(params);
            }
        } catch (error) {
            console.error('UI Automation selector failed:', error);
            return null;
        }
    }

    async findWindows(params) {
        // Windows-specific minimal placeholder
        if (params.windowTitle) {
            // We could return the window center as a click target
            return new DesktopElement(new Point(50, 50));
        }
        return null;
    }

    async findMacOS(params) {
        return null;
    }

    async findLinux(params) {
        return null;
    }
}

// Relative selector - finds element relative to another
class RelativeSelector {
    async find(params) {
        const { anchor, direction, distance = 50 } = params;

        if (!anchor) {
            throw new Error('Anchor element is required for relative selector');
        }

        const selectorEngine = new SelectorEngine();
        const anchorElement = await selectorEngine.findElement(anchor);

        if (!anchorElement) {
            throw new Error('Anchor element not found');
        }

        const anchorPoint = await anchorElement.getCenter();
        let targetPoint;

        switch (direction) {
            case 'above':
                targetPoint = new Point(anchorPoint.x, anchorPoint.y - distance);
                break;
            case 'below':
                targetPoint = new Point(anchorPoint.x, anchorPoint.y + distance);
                break;
            case 'left':
                targetPoint = new Point(anchorPoint.x - distance, anchorPoint.y);
                break;
            case 'right':
                targetPoint = new Point(anchorPoint.x + distance, anchorPoint.y);
                break;
            default:
                throw new Error(`Unknown direction: ${direction}`);
        }

        return new DesktopElement(targetPoint);
    }
}

// Anchor selector - finds element using multiple anchors
class AnchorSelector {
    async find(params) {
        const { target, anchors } = params;

        if (!target || !anchors || anchors.length === 0) {
            throw new Error('Target and anchors are required');
        }

        const selectorEngine = new SelectorEngine();

        // Find all anchor elements
        const anchorElements = [];
        for (const anchor of anchors) {
            const element = await selectorEngine.findElement(anchor);
            if (element) {
                anchorElements.push(element);
            }
        }

        if (anchorElements.length !== anchors.length) {
            throw new Error('Not all anchors found');
        }

        // Simplified: return the target element directly
        const targetElement = await selectorEngine.findElement(target);
        return targetElement;
    }
}

// Wrapper class for desktop elements
class DesktopElement {
    constructor(location) {
        this.location = location;
    }

    async click(button = 'left') {
        const { mouse, Button } = require("@nut-tree-fork/nut-js");
        await mouse.setPosition(this.location);
        await mouse.click(button === 'right' ? Button.RIGHT : Button.LEFT);
    }

    async doubleClick() {
        const { mouse } = require("@nut-tree-fork/nut-js");
        await mouse.setPosition(this.location);
        await mouse.doubleClick();
    }

    async rightClick() {
        await this.click('right');
    }

    async hover() {
        const { mouse } = require("@nut-tree-fork/nut-js");
        await mouse.setPosition(this.location);
    }

    async type(text) {
        const { keyboard } = require("@nut-tree-fork/nut-js");
        await this.click();
        await keyboard.type(text);
    }

    async getBounds() {
        return {
            x: this.location.x - 25,
            y: this.location.y - 25,
            width: 50,
            height: 50
        };
    }

    async getCenter() {
        return this.location;
    }

    async isVisible() {
        return true;
    }

    async isEnabled() {
        return true;
    }
}

module.exports = { SelectorEngine, DesktopElement };