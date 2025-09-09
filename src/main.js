// src/main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Recorder = require('./recorder/AdvancedRecorder');
const AdvancedPlayer = require('./player/AdvancedPlayer');
const { Builder, Parser } = require('xml2js');

const recorder = new Recorder();
const player = new AdvancedPlayer({ highlightElements: true, takeScreenshotsOnError: true });

function createWindow() {
    const win = new BrowserWindow({
        width: 900,
        height: 680,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    win.loadFile('src/index.html');
}

app.whenReady().then(createWindow);

// IPC Handlers
ipcMain.handle('recorder:start', (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.minimize();
    } catch { }
    return recorder.start();
});
ipcMain.handle('recorder:stop', async (event) => {
    const workflow = await recorder.stop();
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.restore();
        win?.focus();
    } catch { }
    return workflow;
});
ipcMain.handle('player:play', async (event, workflow) => {
    const webContents = event?.sender;
    const forward = (kind) => (data) => {
        try { webContents?.send('player:info', { kind, ...data }); } catch { }
    };
    const onStart = forward('activity-start');
    const onComplete = forward('activity-complete');
    const onError = forward('activity-error');
    const onExecStart = forward('execution-start');
    const onExecComplete = forward('execution-complete');
    const onExecError = forward('execution-error');

    player.on('activity:start', onStart);
    player.on('activity:complete', onComplete);
    player.on('activity:error', onError);
    player.on('execution:start', onExecStart);
    player.on('execution:complete', onExecComplete);
    player.on('execution:error', onExecError);

    let win;
    try {
        win = BrowserWindow.fromWebContents(webContents);
        win?.minimize();
    } catch { }

    try {
        const res = await player.play(workflow);
        return res;
    } finally {
        try {
            win?.restore();
            win?.focus();
        } catch { }
        player.off('activity:start', onStart);
        player.off('activity:complete', onComplete);
        player.off('activity:error', onError);
        player.off('execution:start', onExecStart);
        player.off('execution:complete', onExecComplete);
        player.off('execution:error', onExecError);
    }
});

ipcMain.handle('workflow:save', async (event, workflow) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Workflow',
        filters: [{ name: 'FlowRec Workflow', extensions: ['flowrec.json'] }],
        defaultPath: 'workflow.flowrec.json',
    });
    if (canceled || !filePath) return null;
    const content = JSON.stringify(workflow, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
});

ipcMain.handle('workflow:load', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Open Workflow',
        filters: [
            { name: 'FlowRec Workflow (JSON)', extensions: ['flowrec.json', 'json'] },
            { name: 'FlowRec Workflow (XML)', extensions: ['rpa.xml', 'xml'] },
        ],
        properties: ['openFile'],
    });
    if (canceled || !filePaths?.[0]) return null;
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    let data;
    if (filePath.toLowerCase().endsWith('.xml') || filePath.toLowerCase().endsWith('.rpa.xml')) {
        const parser = new Parser({ explicitArray: false, mergeAttrs: true });
        const xmlObj = await parser.parseStringPromise(content);
        data = xmlStepsToJson(xmlObj);
    } else {
        data = JSON.parse(content);
    }
    return { filePath, data };
});

// Save as XML
ipcMain.handle('workflow:save-xml', async (event, workflow) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Workflow (XML)',
        filters: [{ name: 'FlowRec XML', extensions: ['rpa.xml', 'xml'] }],
        defaultPath: 'workflow.rpa.xml',
    });
    if (canceled || !filePath) return null;
    const builder = new Builder({ xmldec: { version: '1.0', encoding: 'UTF-8' } });
    const xmlObj = jsonStepsToXml(workflow);
    const xml = builder.buildObject(xmlObj);
    fs.writeFileSync(filePath, xml, 'utf-8');
    return filePath;
});

function jsonStepsToXml(workflow) {
    const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
    return {
        Workflow: {
            Version: workflow?.version || 1,
            Platform: workflow?.platform || process.platform,
            CreatedAt: workflow?.createdAt || new Date().toISOString(),
            Steps: {
                Step: steps.map((s) => ({
                    Type: s.type,
                    DelayMs: s.delayMs || 0,
                    TargetAppTitle: s.targetAppTitle || '',
                    Mouse: s.mouse ? { Button: s.mouse.button } : undefined,
                    Text: s.text || undefined,
                    Selectors: s.selectors ? {
                        ImagePath: s.selectors.imagePath || undefined,
                        Coordinates: s.selectors.coordinates ? {
                            X: s.selectors.coordinates.x,
                            Y: s.selectors.coordinates.y,
                        } : undefined,
                    } : undefined,
                }))
            }
        }
    };
}

function xmlStepsToJson(xmlObj) {
    const root = xmlObj?.Workflow || xmlObj;
    const stepArray = root?.Steps?.Step || [];
    const steps = Array.isArray(stepArray) ? stepArray : [stepArray];
    return {
        version: Number(root?.Version) || 1,
        createdAt: root?.CreatedAt || new Date().toISOString(),
        platform: root?.Platform || process.platform,
        steps: steps.filter(Boolean).map((s) => ({
            type: s.Type,
            delayMs: Number(s.DelayMs) || 0,
            targetAppTitle: s.TargetAppTitle || '',
            selectors: {
                imagePath: s?.Selectors?.ImagePath || undefined,
                coordinates: s?.Selectors?.Coordinates ? {
                    x: Number(s.Selectors.Coordinates.X),
                    y: Number(s.Selectors.Coordinates.Y),
                } : undefined,
            },
            mouse: s.Mouse && s.Mouse.Button ? { button: String(s.Mouse.Button) } : undefined,
            text: s.Text || undefined,
        }))
    };
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});