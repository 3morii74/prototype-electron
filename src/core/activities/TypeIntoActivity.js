// src/core/activities/TypeIntoActivity.js
class TypeIntoActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const player = require('../../player/AdvancedPlayer');
        const playerInstance = new player();

        return await playerInstance.executeTypeInto({
            ...activity,
            properties
        });
    }
}

module.exports = TypeIntoActivity;