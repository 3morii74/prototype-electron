// src/main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Recorder = require('./recorder');
const Player = require('./player');

const recorder = new Recorder();
const player = new Player();

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
ipcMain.handle('recorder:start', () => recorder.start());
ipcMain.handle('recorder:stop', () => recorder.stop());
ipcMain.handle('player:play', (event, workflow) =>
    player.play(workflow, (info) => {
        const webContents = event?.sender;
        if (webContents) {
            webContents.send('player:info', info);
        }
    })
);

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
        filters: [{ name: 'FlowRec Workflow', extensions: ['flowrec.json', 'json'] }],
        properties: ['openFile'],
    });
    if (canceled || !filePaths?.[0]) return null;
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    return { filePath, data };
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});