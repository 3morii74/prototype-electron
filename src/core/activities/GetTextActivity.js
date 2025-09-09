// src/core/activities/GetTextActivity.js
class GetTextActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const AdvancedPlayer = require('../../player/AdvancedPlayer');
        const playerInstance = new AdvancedPlayer();
        return await playerInstance.executeGetText({
            ...activity,
            properties
        });
    }
}

module.exports = GetTextActivity;

