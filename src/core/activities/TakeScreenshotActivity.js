// src/core/activities/TakeScreenshotActivity.js
class TakeScreenshotActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const AdvancedPlayer = require('../../player/AdvancedPlayer');
        const playerInstance = new AdvancedPlayer();
        return await playerInstance.executeTakeScreenshot({
            ...activity,
            properties
        });
    }
}

module.exports = TakeScreenshotActivity;

