const { app, BrowserWindow, Menu, ipcMain, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const storage = require('./storage');
const shuttle = require('./shuttle');
const importers = require('./importers');
const control = require('./control-server');

// Dev runs store data under the package name ("labprompter"); pin the
// packaged app to the same folder so the script library carries over.
app.setPath('userData', path.join(app.getPath('appData'), 'labprompter'));

const dev = {
  smoke: process.argv.includes('--smoke-test'),
  shot: (process.argv.find((a) => a.startsWith('--shot=')) || '').split('=')[1] || null,
  shotOut: (process.argv.find((a) => a.startsWith('--shot-out=')) || '').split('=')[1] || null,
};

let win = null;
let savedBounds = null;
let blockerId = null;

function setupAutoUpdate() {
  if (!app.isPackaged || dev.smoke || dev.shot) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[update] electron-updater unavailable:', err.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on('error', (err) => console.error('[update]', err ? err.message : 'unknown error'));
  autoUpdater.on('update-downloaded', (info) => {
    // Never pop a dialog onto the prompter mid-read; wait until the
    // operator is back in the editor.
    const offer = () => {
      if (control.getState().presenting) {
        setTimeout(offer, 30000);
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
      if (choice === 0) autoUpdater.quitAndInstall();
    };
    offer();
  });
  autoUpdater.checkForUpdates().catch((err) => console.error('[update] check failed:', err.message));
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
    },
  });

  if (!dev.smoke) {
    win.once('ready-to-show', () => win.show());
  }

  win.on('closed', () => {
    stopBlocker();
    win = null;
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

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Script', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new') },
        { label: 'Import…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('import') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { type: 'separator' },
        { label: 'Start Presenting', accelerator: 'CmdOrCtrl+Return', click: () => sendMenu('present') },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }],
    },
    { role: 'windowMenu' },
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
ipcMain.handle('settings:get', () => storage.getSettings());
ipcMain.handle('settings:set', (e, patch) => storage.setSettings(patch));

// ---- IPC: present mode ----
ipcMain.handle('present:enter', () => {
  if (!win || dev.smoke || dev.shot) return;
  const { screen } = require('electron');
  savedBounds = win.getBounds();
  const settings = storage.getSettings();
  if (settings.autoMoveDisplay) {
    const primary = screen.getPrimaryDisplay();
    const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
    if (external) win.setBounds(external.bounds);
  }
  if (process.platform === 'darwin') win.setSimpleFullScreen(true);
  else win.setFullScreen(true);
  if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
});

ipcMain.handle('present:exit', () => {
  if (!win || dev.smoke || dev.shot) return;
  if (process.platform === 'darwin') win.setSimpleFullScreen(false);
  else win.setFullScreen(false);
  if (savedBounds) win.setBounds(savedBounds);
  stopBlocker();
});

// ---- IPC: shuttle ----
ipcMain.handle('shuttle:status', () => shuttle.getStatus());

// ---- IPC: diagnostics ----
ipcMain.on('renderer:error', (e, msg) => {
  console.error('[labprompter renderer]', msg);
  if (dev.smoke) app.exit(2);
});

ipcMain.on('state:update', (e, patch) => control.setState(patch));

ipcMain.on('renderer:ready', async () => {
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
  shuttle.stop();
  control.stop();
  stopBlocker();
});

app.on('window-all-closed', () => app.quit());
