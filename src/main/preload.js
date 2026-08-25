const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lab', {
  platform: process.platform,
  scripts: {
    list: () => ipcRenderer.invoke('scripts:list'),
    get: (id) => ipcRenderer.invoke('scripts:get', id),
    create: (data) => ipcRenderer.invoke('scripts:create', data),
    save: (script) => ipcRenderer.invoke('scripts:save', script),
    saveNow: (script) => ipcRenderer.send('scripts:saveNow', script),
    remove: (id) => ipcRenderer.invoke('scripts:delete', id),
    importFile: () => ipcRenderer.invoke('scripts:import'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  present: {
    enter: () => ipcRenderer.invoke('present:enter'),
    exit: () => ipcRenderer.invoke('present:exit'),
  },
  shuttle: {
    status: () => ipcRenderer.invoke('shuttle:status'),
    onEvent: (cb) => ipcRenderer.on('shuttle:event', (e, data) => cb(data)),
    onStatus: (cb) => ipcRenderer.on('shuttle:status', (e, data) => cb(data)),
  },
  onMenu: (cb) => ipcRenderer.on('menu:action', (e, action) => cb(action)),
  reportError: (msg) => ipcRenderer.send('renderer:error', msg),
  ready: () => ipcRenderer.send('renderer:ready'),
});
