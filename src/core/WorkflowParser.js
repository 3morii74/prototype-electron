// src/core/WorkflowParser.js
const xml2js = require('xml2js');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class WorkflowParser {
    constructor() {
        this.parser = new xml2js.Parser({
            explicitArray: false,
            mergeAttrs: true,
            normalizeTags: true,
            explicitRoot: false
        });

        this.builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '  ' },
            rootName: 'Workflow'
        });
    }

    async parseWorkflow(filePath) {
        try {
            const xmlContent = await fs.readFile(filePath, 'utf-8');
            const workflow = await this.parseXML(xmlContent);
            return this.transformWorkflow(workflow);
        } catch (error) {
            throw new Error(`Failed to parse workflow: ${error.message}`);
        }
    }

    async parseXML(xmlContent) {
        return new Promise((resolve, reject) => {
            this.parser.parseString(xmlContent, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    transformWorkflow(xmlWorkflow) {
        const workflow = {
            id: xmlWorkflow.id || uuidv4(),
            name: xmlWorkflow.name || 'Untitled Workflow',
            description: xmlWorkflow.description || '',
            version: xmlWorkflow.version || '1.0.0',
            createdAt: xmlWorkflow.createdat || new Date().toISOString(),
            modifiedAt: xmlWorkflow.modifiedat || new Date().toISOString(),
            variables: this.parseVariables(xmlWorkflow.variables),
            arguments: this.parseArguments(xmlWorkflow.arguments),
            imports: this.parseImports(xmlWorkflow.imports),
            mainSequence: this.parseActivity(xmlWorkflow.sequence || xmlWorkflow.mainsequence)
        };

        return workflow;
    }

    parseVariables(variables) {
        if (!variables || !variables.variable) return {};

        const vars = {};
        const varList = Array.isArray(variables.variable) ? variables.variable : [variables.variable];

        for (const variable of varList) {
            vars[variable.name] = {
                type: variable.type || 'Object',
                defaultValue: this.parseValue(variable.defaultvalue),
                description: variable.description || ''
            };
        }

        return vars;
    }

    parseArguments(args) {
        if (!args || !args.argument) return {};

        const argsMap = {};
        const argList = Array.isArray(args.argument) ? args.argument : [args.argument];

        for (const arg of argList) {
            argsMap[arg.name] = {
                type: arg.type || 'Object',
                direction: arg.direction || 'In',
                required: arg.required === 'true',
                defaultValue: this.parseValue(arg.defaultvalue),
                description: arg.description || ''
            };
        }

        return argsMap;
    }

    parseImports(imports) {
        if (!imports || !imports.import) return [];

        const importList = Array.isArray(imports.import) ? imports.import : [imports.import];
        return importList.map(imp => ({
            namespace: imp.namespace,
            assembly: imp.assembly
        }));
    }

    parseActivity(activity) {
        if (!activity) return null;

        const type = activity.type || Object.keys(activity)[0];

        const baseActivity = {
            id: activity.id || uuidv4(),
            type: this.normalizeActivityType(type),
            name: activity.displayname || activity.name || type,
            properties: this.parseProperties(activity),
            continueOnError: activity.continueonerror === 'true',
            timeout: activity.timeout ? parseInt(activity.timeout) : null
        };

        // Parse child activities based on type
        switch (baseActivity.type) {
            case 'Sequence':
                baseActivity.activities = this.parseActivities(activity.activities || activity);
                break;

            case 'If':
                baseActivity.condition = activity.condition;
                baseActivity.then = this.parseActivity(activity.then);
                baseActivity.else = this.parseActivity(activity.else);
                break;

            case 'While':
                baseActivity.condition = activity.condition;
                baseActivity.body = this.parseActivity(activity.body);
                break;

            case 'ForEach':
                baseActivity.values = activity.values;
                baseActivity.body = this.parseActivity(activity.body);
                break;

            case 'Switch':
                baseActivity.expression = activity.expression;
                baseActivity.cases = this.parseSwitchCases(activity.cases);
                baseActivity.default = this.parseActivity(activity.default);
                break;

            case 'TryCatch':
                baseActivity.try = this.parseActivity(activity.try);
                baseActivity.catches = this.parseCatches(activity.catches);
                baseActivity.finally = this.parseActivity(activity.finally);
                break;

            case 'Parallel':
                baseActivity.branches = this.parseActivities(activity.branches);
                break;
        }

        return baseActivity;
    }

    parseActivities(activities) {
        if (!activities) return [];

        const activityList = [];

        // Handle different XML structures
        for (const key in activities) {
            if (key === 'type' || key === 'id' || key === 'displayname') continue;

            const value = activities[key];
            if (Array.isArray(value)) {
                for (const item of value) {
                    activityList.push(this.parseActivity({ ...item, type: key }));
                }
            } else if (typeof value === 'object') {
                activityList.push(this.parseActivity({ ...value, type: key }));
            }
        }

        return activityList;
    }

    parseProperties(activity) {
        const properties = {};
        const excludeKeys = ['type', 'id', 'displayname', 'name', 'continueonerror', 'timeout',
            'activities', 'then', 'else', 'body', 'condition', 'expression',
            'cases', 'default', 'try', 'catches', 'finally', 'branches', 'values'];

        for (const key in activity) {
            if (!excludeKeys.includes(key.toLowerCase())) {
                properties[key] = this.parseValue(activity[key]);
            }
        }

        return properties;
    }

    parseValue(value) {
        if (value === undefined || value === null) return null;

        // Check for expressions
        if (typeof value === 'string') {
            if (value.startsWith('{{') && value.endsWith('}}')) {
                return value; // Variable reference
            }
            if (value.startsWith('=')) {
                return value; // Expression
            }
        }

        // Try to parse as JSON
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    parseSwitchCases(cases) {
        if (!cases || !cases.case) return [];

        const caseList = Array.isArray(cases.case) ? cases.case : [cases.case];
        return caseList.map(c => ({
            value: c.value,
            activity: this.parseActivity(c.activity || c)
        }));
    }

    parseCatches(catches) {
        if (!catches || !catches.catch) return [];

        const catchList = Array.isArray(catches.catch) ? catches.catch : [catches.catch];
        return catchList.map(c => ({
            exceptionType: c.exceptiontype || 'System.Exception',
            activity: this.parseActivity(c.activity || c)
        }));
    }

    normalizeActivityType(type) {
        // Map XML element names to activity types
        const typeMap = {
            'sequence': 'Sequence',
            'if': 'If',
            'while': 'While',
            'foreach': 'ForEach',
            'switch': 'Switch',
            'trycatch': 'TryCatch',
            'parallel': 'Parallel',
            'click': 'Click',
            'typeinto': 'TypeInto',
            'gettext': 'GetText',
            'selectitem': 'SelectItem',
            'hover': 'Hover',
            'keyboardshortcut': 'KeyboardShortcut',
            'takescreenshot': 'TakeScreenshot',
            'openbrowser': 'OpenBrowser',
            'closebrowser': 'CloseBrowser',
            'navigateto': 'NavigateTo',
            'extractdata': 'ExtractData',
            'assign': 'Assign',
            'delay': 'Delay',
            'logmessage': 'LogMessage',
            'messagebox': 'MessageBox',
            'invokeworkflow': 'InvokeWorkflow',
            'readcsv': 'ReadCSV',
            'writecsv': 'WriteCSV',
            'readexcel': 'ReadExcel',
            'writeexcel': 'WriteExcel'
        };

        return typeMap[type.toLowerCase()] || type;
    }

    async saveWorkflow(workflow, filePath) {
        const xmlWorkflow = this.transformToXML(workflow);
        const xmlString = this.builder.buildObject(xmlWorkflow);
        await fs.writeFile(filePath, xmlString, 'utf-8');
    }

    transformToXML(workflow) {
        const xmlWorkflow = {
            $: {
                xmlns: 'http://schemas.rpastudio.com/workflow',
                'xmlns:x': 'http://schemas.microsoft.com/winfx/2006/xaml',
                id: workflow.id,
                name: workflow.name,
                version: workflow.version
            },
            Description: workflow.description,
            CreatedAt: workflow.createdAt,
            ModifiedAt: workflow.modifiedAt
        };

        if (workflow.variables && Object.keys(workflow.variables).length > 0) {
            xmlWorkflow.Variables = {
                Variable: Object.entries(workflow.variables).map(([name, config]) => ({
                    $: {
                        name,
                        type: config.type,
                        defaultValue: JSON.stringify(config.defaultValue)
                    },
                    Description: config.description
                }))
            };
        }

        if (workflow.arguments && Object.keys(workflow.arguments).length > 0) {
            xmlWorkflow.Arguments = {
                Argument: Object.entries(workflow.arguments).map(([name, config]) => ({
                    $: {
                        name,
                        type: config.type,
                        direction: config.direction,
                        required: config.required,
                        defaultValue: JSON.stringify(config.defaultValue)
                    },
                    Description: config.description
                }))
            };
        }

        if (workflow.imports && workflow.imports.length > 0) {
            xmlWorkflow.Imports = {
                Import: workflow.imports.map(imp => ({
                    $: {
                        namespace: imp.namespace,
                        assembly: imp.assembly
                    }
                }))
            };
        }

        if (workflow.mainSequence) {
            xmlWorkflow.Sequence = this.activityToXML(workflow.mainSequence);
        }

        return xmlWorkflow;
    }

    activityToXML(activity) {
        if (!activity) return null;

        const xmlActivity = {
            $: {
                id: activity.id,
                displayName: activity.name
            }
        };

        if (activity.continueOnError) {
            xmlActivity.$.continueOnError = 'true';
        }

        if (activity.timeout) {
            xmlActivity.$.timeout = activity.timeout.toString();
        }

        // Add properties
        for (const [key, value] of Object.entries(activity.properties || {})) {
            xmlActivity[key] = typeof value === 'object' ? JSON.stringify(value) : value;
        }

        // Handle specific activity types
        switch (activity.type) {
            case 'Sequence':
                if (activity.activities && activity.activities.length > 0) {
                    xmlActivity.Activities = {};
                    for (const child of activity.activities) {
                        const childXml = this.activityToXML(child);
                        const childType = child.type;

                        if (!xmlActivity.Activities[childType]) {
                            xmlActivity.Activities[childType] = [];
                        }
                        xmlActivity.Activities[childType].push(childXml);
                    }
                }
                break;

            case 'If':
                xmlActivity.Condition = activity.condition;
                if (activity.then) {
                    xmlActivity.Then = this.activityToXML(activity.then);
                }
                if (activity.else) {
                    xmlActivity.Else = this.activityToXML(activity.else);
                }
                break;

            // Add other activity type transformations...
        }

        return xmlActivity;
    }
}

module.exports = WorkflowParser;