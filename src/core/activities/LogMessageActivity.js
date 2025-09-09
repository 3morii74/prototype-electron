// src/core/activities/LogMessageActivity.js
class LogMessageActivity {
    constructor(engine) {
        this.engine = engine;
    }

    async execute(properties) {
        const level = (properties?.level || 'info').toLowerCase();
        const message = properties?.message || '';
        const consoleFn = console[level] || console.info;
        consoleFn(`[LogMessage] ${message}`);
        return null;
    }
}

module.exports = LogMessageActivity;

