// Dev tool: regenerates all app + Stream Deck icons.
// Run with: npx electron tools/make-icons.js
// Then: iconutil -c icns build/icon.iconset -o build/icon.icns
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, 'icons.html'));
});

ipcMain.on('icons-done', (e, count) => {
  console.log('ICONS_OK', count);
  app.exit(0);
});

ipcMain.on('icons-error', (e, msg) => {
  console.error('[make-icons]', msg);
  app.exit(1);
});

setTimeout(() => {
  console.error('[make-icons] timed out');
  app.exit(1);
}, 15000);
