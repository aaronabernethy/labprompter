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
  onRemote: (cb) => ipcRenderer.on('remote:action', (e, action) => cb(action)),
  state: (patch) => ipcRenderer.send('state:update', patch),
  remote: {
    services: () => ipcRenderer.invoke('remote:list'),
    onServices: (cb) => ipcRenderer.on('remote:services', (e, list) => cb(list)),
    connect: (target) => ipcRenderer.invoke('remote:connect', target),
    disconnect: () => ipcRenderer.invoke('remote:disconnect'),
    onStatus: (cb) => ipcRenderer.on('remote:client-status', (e, s) => cb(s)),
    onDoc: (cb) => ipcRenderer.on('remote:client-doc', (e, d) => cb(d)),
    onState: (cb) => ipcRenderer.on('remote:client-state', (e, s) => cb(s)),
    send: (msg) => ipcRenderer.send('remote:send', msg),
    pushDoc: (doc) => ipcRenderer.send('remote:doc', doc),
  },
  operator: {
    ready: () => ipcRenderer.send('operator:ready'),
    cmd: (action) => ipcRenderer.send('operator:cmd', action),
    edit: (body) => ipcRenderer.send('operator:edit', body),
    onDoc: (cb) => ipcRenderer.on('operator:doc', (e, d) => cb(d)),
    onState: (cb) => ipcRenderer.on('operator:state', (e, s) => cb(s)),
  },
  onLiveEdit: (cb) => ipcRenderer.on('live:edit', (e, body) => cb(body)),
  reportError: (msg) => ipcRenderer.send('renderer:error', msg),
  ready: () => ipcRenderer.send('renderer:ready'),
});
