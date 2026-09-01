const { app, BrowserWindow, Menu, ipcMain, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const storage = require('./storage');
const shuttle = require('./shuttle');
const importers = require('./importers');
const control = require('./control-server');
const remote = require('./remote');

// Dev runs store data under the package name ("labprompter"); pin the
// packaged app to the same folder so the script library carries over.
app.setPath('userData', path.join(app.getPath('appData'), 'labprompter'));

const dev = {
  smoke: process.argv.includes('--smoke-test'),
  shot: (process.argv.find((a) => a.startsWith('--shot=')) || '').split('=')[1] || null,
  shotOut: (process.argv.find((a) => a.startsWith('--shot-out=')) || '').split('=')[1] || null,
  connect: (process.argv.find((a) => a.startsWith('--connect=')) || '').split('=')[1] || null,
};

let win = null;
let savedBounds = null;
let blockerId = null;
let operatorWin = null;
let operatorClosing = false;

// ---- Updates ----
// Everything the updater does is appended to userData/update.log so a
// studio-machine failure can be diagnosed after the fact.

const updater = { instance: null, downloaded: null };

function updateLog(level, ...args) {
  const line = `[${new Date().toISOString()}] ${level} ${args.join(' ')}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), line);
  } catch {
    // logging must never break the app
  }
}

function initUpdater() {
  if (!app.isPackaged || dev.smoke || dev.shot) return null;
  if (updater.instance) return updater.instance;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[update] electron-updater unavailable:', err.message);
    return null;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.logger = {
    info: (...a) => updateLog('info', ...a),
    warn: (...a) => updateLog('warn', ...a),
    error: (...a) => updateLog('error', ...a),
    debug: (...a) => updateLog('debug', ...a),
  };
  autoUpdater.on('error', (err) => updateLog('error', 'event:', err ? err.stack || err.message : 'unknown'));
  autoUpdater.on('update-downloaded', (info) => {
    updater.downloaded = info;
    offerInstall(info);
  });
  updater.instance = autoUpdater;
  return autoUpdater;
}

function installDownloadedUpdate() {
  updateLog('info', 'user chose Install & Restart; invoking quitAndInstall');
  // quitAndInstall can silently no-op when called from inside a dialog
  // callback or when a window-all-closed handler re-enters quit; defer it
  // and drop our handler first.
  setImmediate(() => {
    try {
      app.removeAllListeners('window-all-closed');
      updater.instance.quitAndInstall(false, true);
    } catch (err) {
      updateLog('error', 'quitAndInstall threw:', err.stack || err.message);
    }
  });
}

function offerInstall(info) {
  // Never pop a dialog onto the prompter mid-read; wait until the
  // operator is back in the editor.
  if (control.getState().presenting) {
    setTimeout(() => offerInstall(info), 30000);
    return;
  }
  const choice = dialog.showMessageBoxSync(win, {
    type: 'info',
    buttons: ['Install & Restart', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `LabPrompter ${info.version} is ready to install.`,
    detail: 'The update downloaded in the background. Install it now? "Later" installs it the next time you quit.',
  });
  if (choice === 0) installDownloadedUpdate();
}

function setupAutoUpdate() {
  const u = initUpdater();
  if (!u) return;
  u.checkForUpdates().catch((err) => updateLog('error', 'startup check failed:', err.message));
}

function cmpVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function manualUpdateCheck() {
  if (!app.isPackaged) {
    dialog.showMessageBox(win, {
      type: 'info',
      message: 'Updates apply to the installed app.',
      detail: 'This copy is running from source; pull the repo instead.',
    });
    return;
  }
  const u = initUpdater();
  if (!u) return;
  if (updater.downloaded) {
    offerInstall(updater.downloaded);
    return;
  }
  updateLog('info', 'manual check requested');
  u.checkForUpdates()
    .then((res) => {
      const latest = res && res.updateInfo ? res.updateInfo.version : null;
      if (latest && cmpVersions(latest, app.getVersion()) > 0) {
        dialog.showMessageBox(win, {
          type: 'info',
          message: `LabPrompter ${latest} is available.`,
          detail: "It's downloading in the background — you'll be asked to install once it's ready.",
        });
      } else {
        dialog.showMessageBox(win, {
          type: 'info',
          message: "You're up to date.",
          detail: `LabPrompter ${app.getVersion()} is the latest version.`,
        });
      }
    })
    .catch((err) => {
      updateLog('error', 'manual check failed:', err.stack || err.message);
      dialog.showMessageBox(win, {
        type: 'warning',
        message: 'Could not check for updates.',
        detail: String((err && err.message) || err),
      });
    });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0f1114',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // This window runs the prompter engine; keep it ticking even if the
      // Operator View (or anything else) occludes it while presenting.
      backgroundThrottling: false,
    },
  });

  if (!dev.smoke) {
    win.once('ready-to-show', () => win.show());
  }

  win.on('closed', () => {
    stopBlocker();
    win = null;
    closeOperatorWindow();
  });

  win.webContents.on('render-process-gone', (e, details) => {
    console.error('[labprompter] renderer gone:', details.reason);
    if (dev.smoke || dev.shot) app.exit(2);
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function sendMenu(action) {
  if (win) win.webContents.send('menu:action', action);
}

// ---- Operator View (Extended display mode) ----
// In Extended Mode the main window becomes the talent-facing Present screen,
// and this second window stays on the operator's display, rendering the same
// main-process state the remote-control mirror consumes.

function sendOperator(channel, data) {
  if (operatorWin && !operatorWin.isDestroyed()) operatorWin.webContents.send(channel, data);
}

function openOperatorWindow(bounds) {
  if (operatorWin) return;
  operatorClosing = false;
  operatorWin = new BrowserWindow({
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    width: bounds ? bounds.width : 1100,
    height: bounds ? bounds.height : 700,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0f1114',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  operatorWin.on('closed', () => {
    operatorWin = null;
    // The operator dismissing their window means "stop presenting" — unless
    // it was closed as part of Present Mode already exiting.
    if (!operatorClosing && win && !win.isDestroyed()) {
      win.webContents.send('remote:action', 'exitPresent');
    }
  });
  operatorWin.loadFile(path.join(__dirname, '..', 'renderer', 'operator.html'));
}

function closeOperatorWindow() {
  if (!operatorWin) return;
  operatorClosing = true;
  operatorWin.close();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const settingsItem = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Script', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new') },
        { label: 'Import…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('import') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: 'Duplicate Script', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('duplicate') },
        { type: 'separator' },
        { label: 'Start Presenting', accelerator: 'CmdOrCtrl+Return', click: () => sendMenu('present') },
        ...(isMac ? [{ type: 'separator' }, { role: 'close' }] : [settingsItem]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Check for Updates…', click: () => manualUpdateCheck() }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopBlocker() {
  if (blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
}

// ---- IPC: scripts ----
ipcMain.handle('scripts:list', () => storage.listScripts());
ipcMain.handle('scripts:get', (e, id) => storage.getScript(id));
ipcMain.handle('scripts:create', (e, data) => storage.createScript(data || {}));
ipcMain.handle('scripts:save', (e, script) => storage.saveScript(script));
ipcMain.handle('scripts:delete', (e, id) => storage.deleteScript(id));
ipcMain.on('scripts:saveNow', (e, script) => {
  try {
    storage.saveScript(script);
  } catch (err) {
    console.error('[labprompter] saveNow failed:', err);
  }
});

ipcMain.handle('scripts:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import script',
    filters: [{ name: 'Scripts', extensions: ['txt', 'text', 'md', 'docx'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return importers.importPath(res.filePaths[0]);
});

// ---- IPC: settings ----
// lastRemote is main-process state (the auto-reconnect target); keep it out
// of the renderer's settings round-trip so a stale copy can't resurrect it.
ipcMain.handle('settings:get', () => {
  const { lastRemote, ...rest } = storage.getSettings();
  return rest;
});
ipcMain.handle('settings:set', (e, patch) => {
  if (patch) delete patch.lastRemote;
  const before = storage.getSettings().allowRemote;
  const merged = storage.setSettings(patch);
  if (merged.allowRemote !== before) {
    if (merged.allowRemote) startRemoteServer();
    else remote.stopServer();
  }
  const { lastRemote, ...rest } = merged;
  return rest;
});

// ---- IPC: present mode ----
ipcMain.handle('present:enter', () => {
  if (!win || dev.smoke || dev.shot) return;
  const { screen } = require('electron');
  savedBounds = win.getBounds();
  const settings = storage.getSettings();
  const extended = settings.displayMode === 'extended';
  // Extended Mode always presents on the display wired to the prompter; the
  // auto-move toggle only applies to the mirrored setup.
  if (extended || settings.autoMoveDisplay) {
    const primary = screen.getPrimaryDisplay();
    const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
    if (external) win.setBounds(external.bounds);
  }
  if (process.platform === 'darwin') win.setSimpleFullScreen(true);
  else win.setFullScreen(true);
  if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
  if (extended) openOperatorWindow(savedBounds);
});

ipcMain.handle('present:exit', () => {
  if (!win || dev.smoke || dev.shot) return;
  closeOperatorWindow();
  if (process.platform === 'darwin') win.setSimpleFullScreen(false);
  else win.setFullScreen(false);
  if (savedBounds) win.setBounds(savedBounds);
  stopBlocker();
  win.focus();
});

// ---- IPC: shuttle ----
ipcMain.handle('shuttle:status', () => shuttle.getStatus());

// ---- IPC: diagnostics ----
ipcMain.on('renderer:error', (e, msg) => {
  console.error('[labprompter renderer]', msg);
  if (dev.smoke) app.exit(2);
});

ipcMain.on('state:update', (e, patch) => {
  control.setState(patch);
  remote.broadcast({ t: 'state', ...patch });
  sendOperator('operator:state', patch);
});

// ---- IPC: Operator View window ----
ipcMain.on('operator:ready', () => {
  if (lastDoc) sendOperator('operator:doc', lastDoc);
  sendOperator('operator:state', control.getState());
});

ipcMain.on('operator:cmd', (e, action) => {
  if (typeof action === 'string' && win) win.webContents.send('remote:action', action);
});

ipcMain.on('operator:edit', (e, body) => {
  if (typeof body === 'string' && win) win.webContents.send('live:edit', body);
});

// ---- IPC + wiring: network remote control ----
let lastDoc = null;

function startRemoteServer() {
  remote.startServer({
    onCommand: (action) => {
      if (win) win.webContents.send('remote:action', action);
    },
    onInput: (ev) => {
      if (win) win.webContents.send('shuttle:event', ev);
    },
    // Remote edits ride the same path as Operator View edits.
    onEdit: (body) => {
      if (win) win.webContents.send('live:edit', body);
    },
    getDoc: () => lastDoc,
    getState: () => control.getState(),
  });
}

ipcMain.on('remote:doc', (e, doc) => {
  lastDoc = doc;
  remote.broadcast({ t: 'doc', ...doc });
  sendOperator('operator:doc', doc);
});

// ---- Auto-reconnect to the last remote host ----
// The target is remembered on every successful connect and forgotten on a
// deliberate disconnect, so a crash or restart on either end self-heals:
// launch and connection loss retry every few seconds, and the host
// reappearing in Bonjour (matched by instance id, so IP changes don't
// matter) reconnects immediately.

// Never auto-connect before the renderer is listening: a "connected" status
// sent into a not-yet-ready window is lost, leaving a link the UI knows
// nothing about.
let rendererReady = false;

const reconnect = { timer: null, lastTriedHost: null };

function cancelReconnect() {
  clearTimeout(reconnect.timer);
  reconnect.timer = null;
  reconnect.lastTriedHost = null;
}

function attemptReconnect() {
  clearTimeout(reconnect.timer);
  reconnect.timer = null;
  const target = storage.getSettings().lastRemote;
  if (!rendererReady || !target || remote.isConnected()) return;
  const svc = remote.listDiscovered().find((s) => target.id && s.id === target.id);
  reconnect.lastTriedHost = svc ? svc.host : target.host;
  remote.connect(reconnect.lastTriedHost, (svc ? svc.port : target.port) || undefined, clientCallbacks);
}

const clientCallbacks = {
  onStatus: (s) => {
    if (s.connected) {
      cancelReconnect();
      storage.setSettings({ lastRemote: { host: s.host, port: s.port, name: s.name, id: s.id } });
    } else if (s.error === 'connected to self') {
      cancelReconnect();
      storage.setSettings({ lastRemote: null });
    } else {
      const target = storage.getSettings().lastRemote;
      // Retry only failures of the remembered target, not a manual attempt
      // at some other host the user is trying from the modal.
      if (target && (s.host === target.host || s.host === reconnect.lastTriedHost)) {
        clearTimeout(reconnect.timer);
        reconnect.timer = setTimeout(attemptReconnect, 5000);
        s = { ...s, reconnecting: true, targetName: target.name || target.host };
      }
    }
    if (win) win.webContents.send('remote:client-status', s);
  },
  onDoc: (d) => {
    if (win) win.webContents.send('remote:client-doc', d);
  },
  onState: (s) => {
    if (win) win.webContents.send('remote:client-state', s);
  },
};

ipcMain.handle('remote:list', () => remote.listDiscovered());
ipcMain.handle('remote:connect', (e, { host, port }) => remote.connect(host, port, clientCallbacks));
ipcMain.handle('remote:disconnect', () => {
  // Deliberate disconnect: forget the host so auto-reconnect stays quiet.
  cancelReconnect();
  storage.setSettings({ lastRemote: null });
  return remote.disconnect();
});
ipcMain.on('remote:send', (e, msg) => remote.clientSend(msg));

ipcMain.on('renderer:ready', async () => {
  rendererReady = true;
  if (dev.connect && !dev.smoke) {
    const [host, port] = dev.connect.split(':');
    remote.connect(host, port ? Number(port) : undefined, clientCallbacks);
  } else if (!dev.smoke && !dev.shot && storage.getSettings().lastRemote) {
    // Pick the last session's host back up automatically.
    attemptReconnect();
  }
  if (dev.smoke) {
    const http = require('http');
    http
      .get(`http://127.0.0.1:${control.PORT}/state`, (res) => {
        if (res.statusCode === 200) {
          console.log('SMOKE_OK');
        } else {
          console.error('[labprompter] control server bad status:', res.statusCode);
          app.exitCode = 2;
        }
        setTimeout(() => app.exit(app.exitCode || 0), 100);
      })
      .on('error', (err) => {
        console.error('[labprompter] control server unreachable:', err.message);
        app.exit(2);
      });
    return;
  }
  if (dev.shot) {
    try {
      await new Promise((r) => setTimeout(r, 500));
      if (dev.shot === 'present') {
        sendMenu('present');
        await new Promise((r) => setTimeout(r, 900));
      }
      if (dev.shot === 'remote') {
        await new Promise((r) => setTimeout(r, 2000));
      }
      const img = await win.webContents.capturePage();
      const out = dev.shotOut || path.join(app.getPath('temp'), `labprompter-${dev.shot}.png`);
      fs.writeFileSync(out, img.toPNG());
      console.log('SHOT_SAVED ' + out);
      app.exit(0);
    } catch (err) {
      console.error('[labprompter] shot failed:', err);
      app.exit(4);
    }
  }
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) {
    const dockIcon = path.join(__dirname, '..', 'assets', 'icon.png');
    if (fs.existsSync(dockIcon)) app.dock.setIcon(dockIcon);
  }
  buildMenu();
  createWindow();
  setupAutoUpdate();
  if (storage.getSettings().allowRemote && !dev.smoke) startRemoteServer();
  remote.startDiscovery((list) => {
    if (win) win.webContents.send('remote:services', list);
    // The remembered host just (re)appeared — reconnect right away, at
    // whatever address it advertises now.
    const target = storage.getSettings().lastRemote;
    if (target && !remote.isConnected() && !dev.smoke && !dev.shot && !dev.connect) {
      if (list.some((s) => target.id && s.id === target.id)) attemptReconnect();
    }
  });
  control.start({
    onCommand: (action) => {
      if (win) win.webContents.send('remote:action', action);
    },
  });
  shuttle.start({
    onEvent: (ev) => {
      if (win) win.webContents.send('shuttle:event', ev);
    },
    onStatus: (st) => {
      if (win) win.webContents.send('shuttle:status', st);
      sendOperator('shuttle:status', st);
    },
  });
  if (dev.smoke) {
    setTimeout(() => {
      console.error('[labprompter] smoke test timed out');
      app.exit(3);
    }, 15000);
  }
});

app.on('before-quit', () => {
  cancelReconnect();
  shuttle.stop();
  control.stop();
  remote.stopAll();
  stopBlocker();
});

app.on('window-all-closed', () => app.quit());
