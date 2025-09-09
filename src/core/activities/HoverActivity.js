// src/core/activities/HoverActivity.js
class HoverActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const AdvancedPlayer = require('../../player/AdvancedPlayer');
        const playerInstance = new AdvancedPlayer();
        return await playerInstance.executeHover({
            ...activity,
            properties
        });
    }
}

module.exports = HoverActivity;

