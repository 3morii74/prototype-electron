// src/core/activities/SequenceActivity.js
class SequenceActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties, activity) {
        const activities = Array.isArray(activity.activities) ? activity.activities : [];
        let lastResult = null;
        for (const child of activities) {
            lastResult = await this.engine.executeActivity(child);
        }
        return lastResult;
    }
}

module.exports = SequenceActivity;

