// src/core/activities/DelayActivity.js
class DelayActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties) {
        const ms = Number(properties?.duration || properties?.delayMs || 0);
        if (ms > 0) {
            await new Promise(r => setTimeout(r, ms));
        }
        return null;
    }
}

module.exports = DelayActivity;

