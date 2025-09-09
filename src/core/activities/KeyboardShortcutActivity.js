// src/core/activities/KeyboardShortcutActivity.js
class KeyboardShortcutActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const AdvancedPlayer = require('../../player/AdvancedPlayer');
        const playerInstance = new AdvancedPlayer();
        return await playerInstance.executeKeyboardShortcut({
            ...activity,
            properties
        });
    }
}

module.exports = KeyboardShortcutActivity;

