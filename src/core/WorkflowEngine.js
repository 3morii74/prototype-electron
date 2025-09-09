// src/core/WorkflowEngine.js
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

class WorkflowEngine extends EventEmitter {
    constructor() {
        super();
        this.activities = new Map();
        this.executionContext = new Map();
        this.variables = new Map();
        this.currentWorkflow = null;
        this.executionStack = [];
        this.breakpoints = new Set();
        this.isDebugging = false;
        this.isPaused = false;

        // Register core activities
        this.registerCoreActivities();
    }

    registerCoreActivities() {
        // Minimal set needed for current recorder/player
        this.registerActivity('Click', require('./activities/ClickActivity'));
        this.registerActivity('TypeInto', require('./activities/TypeIntoActivity'));
        this.registerActivity('GetText', require('./activities/GetTextActivity'));
        this.registerActivity('SelectItem', require('./activities/SelectItemActivity'));
        this.registerActivity('Hover', require('./activities/HoverActivity'));
        this.registerActivity('KeyboardShortcut', require('./activities/KeyboardShortcutActivity'));
        this.registerActivity('TakeScreenshot', require('./activities/TakeScreenshotActivity'));
        this.registerActivity('MouseScroll', require('./activities/MouseScrollActivity'));
        this.registerActivity('Sequence', require('./activities/SequenceActivity'));
        this.registerActivity('Delay', require('./activities/DelayActivity'));
        this.registerActivity('LogMessage', require('./activities/LogMessageActivity'));
    }

    registerActivity(name, ActivityClass) {
        this.activities.set(name, ActivityClass);
        logger.info(`Registered activity: ${name}`);
    }

    async executeWorkflow(workflow, options = {}) {
        try {
            this.currentWorkflow = workflow;
            this.isDebugging = options.debug || false;
            this.variables.clear();
            this.executionContext.clear();

            // Initialize workflow variables
            if (workflow.variables) {
                for (const [name, config] of Object.entries(workflow.variables)) {
                    this.variables.set(name, {
                        value: config.defaultValue,
                        type: config.type,
                        scope: 'workflow'
                    });
                }
            }

            // Set input arguments
            if (options.arguments) {
                for (const [name, value] of Object.entries(options.arguments)) {
                    this.variables.set(name, {
                        value,
                        type: typeof value,
                        scope: 'argument'
                    });
                }
            }

            this.emit('workflow:start', {
                id: workflow.id,
                name: workflow.name,
                timestamp: new Date()
            });

            logger.info(`Starting workflow execution: ${workflow.name}`);

            // Execute main sequence
            const result = await this.executeActivity(workflow.mainSequence);

            this.emit('workflow:complete', {
                id: workflow.id,
                name: workflow.name,
                result,
                timestamp: new Date()
            });

            logger.info(`Workflow execution completed: ${workflow.name}`);

            return {
                success: true,
                result,
                variables: Object.fromEntries(this.variables)
            };

        } catch (error) {
            logger.error(`Workflow execution failed: ${error.message}`, error);

            this.emit('workflow:error', {
                id: workflow.id,
                name: workflow.name,
                error: error.message,
                stack: error.stack,
                timestamp: new Date()
            });

            return {
                success: false,
                error: error.message,
                stack: error.stack
            };
        }
    }

    async executeActivity(activity) {
        if (!activity) return null;

        const activityId = activity.id || uuidv4();
        const startTime = Date.now();

        try {
            // Check if we should pause for debugging
            if (this.isDebugging && this.breakpoints.has(activityId)) {
                await this.pauseExecution(activityId);
            }

            this.executionStack.push({
                id: activityId,
                type: activity.type,
                name: activity.name || activity.type,
                startTime
            });

            this.emit('activity:start', {
                id: activityId,
                type: activity.type,
                name: activity.name,
                properties: activity.properties
            });

            logger.debug(`Executing activity: ${activity.type} (${activityId})`);

            // Get activity implementation
            const ActivityClass = this.activities.get(activity.type);
            if (!ActivityClass) {
                throw new Error(`Unknown activity type: ${activity.type}`);
            }

            // Create activity instance
            const activityInstance = new ActivityClass(this);

            // Resolve property values
            const resolvedProperties = await this.resolveProperties(activity.properties);

            // Execute activity
            const result = await activityInstance.execute(resolvedProperties, activity);

            const executionTime = Date.now() - startTime;

            this.executionStack.pop();

            this.emit('activity:complete', {
                id: activityId,
                type: activity.type,
                name: activity.name,
                result,
                executionTime
            });

            logger.debug(`Activity completed: ${activity.type} (${activityId}) in ${executionTime}ms`);

            return result;

        } catch (error) {
            this.executionStack.pop();

            this.emit('activity:error', {
                id: activityId,
                type: activity.type,
                name: activity.name,
                error: error.message,
                stack: error.stack
            });

            logger.error(`Activity failed: ${activity.type} (${activityId})`, error);

            // Handle error based on activity configuration
            if (activity.continueOnError) {
                return null;
            }

            throw error;
        }
    }

    async resolveProperties(properties) {
        if (!properties) return {};

        const resolved = {};

        for (const [key, value] of Object.entries(properties)) {
            if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
                // Variable reference
                const varName = value.slice(2, -2).trim();
                const variable = this.variables.get(varName);
                resolved[key] = variable ? variable.value : null;
            } else if (typeof value === 'string' && value.startsWith('=')) {
                // Expression
                resolved[key] = await this.evaluateExpression(value.slice(1));
            } else if (Array.isArray(value)) {
                // Preserve arrays and resolve each element
                const arr = [];
                for (const element of value) {
                    if (typeof element === 'object' && element !== null) {
                        arr.push(await this.resolveProperties(element));
                    } else {
                        arr.push(element);
                    }
                }
                resolved[key] = arr;
            } else if (typeof value === 'object' && value !== null) {
                // Nested object
                resolved[key] = await this.resolveProperties(value);
            } else {
                // Literal value
                resolved[key] = value;
            }
        }

        return resolved;
    }

    async evaluateExpression(expression) {
        // Simple expression evaluator - in production, use a proper expression parser
        try {
            // Create a safe evaluation context with variables
            const context = {};
            for (const [name, variable] of this.variables) {
                context[name] = variable.value;
            }

            // Add utility functions
            context.String = String;
            context.Number = Number;
            context.Boolean = Boolean;
            context.Date = Date;
            context.Array = Array;
            context.Object = Object;
            context.Math = Math;
            context.JSON = JSON;

            // Evaluate expression in isolated context
            const func = new Function(...Object.keys(context), `return ${expression}`);
            return func(...Object.values(context));

        } catch (error) {
            logger.error(`Expression evaluation failed: ${expression}`, error);
            throw new Error(`Invalid expression: ${expression}`);
        }
    }

    setVariable(name, value, scope = 'local') {
        this.variables.set(name, {
            value,
            type: typeof value,
            scope
        });

        this.emit('variable:changed', {
            name,
            value,
            scope
        });
    }

    getVariable(name) {
        const variable = this.variables.get(name);
        return variable ? variable.value : undefined;
    }

    async pauseExecution(activityId) {
        this.isPaused = true;

        this.emit('execution:paused', {
            activityId,
            variables: Object.fromEntries(this.variables),
            stack: [...this.executionStack]
        });

        // Wait for resume signal
        return new Promise((resolve) => {
            this.once('execution:resume', resolve);
        });
    }

    resume() {
        this.isPaused = false;
        this.emit('execution:resume');
    }

    stop() {
        this.emit('execution:stop');
        // Cleanup resources
        this.variables.clear();
        this.executionContext.clear();
        this.executionStack = [];
    }

    addBreakpoint(activityId) {
        this.breakpoints.add(activityId);
    }

    removeBreakpoint(activityId) {
        this.breakpoints.delete(activityId);
    }

    getExecutionState() {
        return {
            isPaused: this.isPaused,
            isDebugging: this.isDebugging,
            variables: Object.fromEntries(this.variables),
            stack: [...this.executionStack],
            breakpoints: [...this.breakpoints]
        };
    }
}

module.exports = WorkflowEngine;