// src/core/activities/SelectItemActivity.js
class SelectItemActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const AdvancedPlayer = require('../../player/AdvancedPlayer');
        const playerInstance = new AdvancedPlayer();
        return await playerInstance.executeSelectItem({
            ...activity,
            properties
        });
    }
}

module.exports = SelectItemActivity;

