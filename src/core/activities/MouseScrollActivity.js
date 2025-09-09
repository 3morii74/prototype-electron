// src/core/activities/MouseScrollActivity.js
class MouseScrollActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const AdvancedPlayer = require('../../player/AdvancedPlayer');
        const playerInstance = new AdvancedPlayer();
        return await playerInstance.executeMouseScroll({
            ...activity,
            properties
        });
    }
}

module.exports = MouseScrollActivity;

