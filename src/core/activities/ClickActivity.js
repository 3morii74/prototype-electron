// src/core/activities/ClickActivity.js
class ClickActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const player = require('../../player/AdvancedPlayer');
        const playerInstance = new player();

        return await playerInstance.executeClick({
            ...activity,
            properties
        });
    }
}

module.exports = ClickActivity;