// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    startRecording: () => ipcRenderer.invoke('recorder:start'),
    stopRecording: () => ipcRenderer.invoke('recorder:stop'),
    playWorkflow: (workflow) => ipcRenderer.invoke('player:play', workflow),
    saveWorkflow: (workflow) => ipcRenderer.invoke('workflow:save', workflow),
    loadWorkflow: () => ipcRenderer.invoke('workflow:load'),
    onPlayerInfo: (handler) => ipcRenderer.on('player:info', (_e, info) => handler(info)),
});