/* Anmerkung Processor — Electron main process.
   Wraps the existing anmerkung.html static app in a desktop window. */

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const fs   = require('node:fs');

/**
 * Locate the bundled anmerkung.html.
 *   • Packaged: copied via `extraResources` to <resourcesPath>/app/anmerkung.html
 *   • Dev (`npm start` from electron/): falls back to ../anmerkung.html
 */
function resolveHtmlPath() {
  const packed = path.join(process.resourcesPath || '', 'app', 'anmerkung.html');
  if (fs.existsSync(packed)) return packed;
  return path.join(__dirname, '..', 'anmerkung.html');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#02020a',
    title: 'Anmerkung Processor',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Strip the default menu — this is a single-page tool, not a multi-doc editor.
  Menu.setApplicationMenu(null);

  win.loadFile(resolveHtmlPath());

  // The bundled HTML has a "← Grimoire" back-link and a footer linking to
  // sibling pages (index.html, code.html, qa.html) that aren't shipped with
  // this single-page desktop build. Hide them after load to avoid dead clicks.
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      .nav-back { display: none !important; }
      .footer a[href$=".html"], .footer .fsep { display: none !important; }
    `).catch(() => { /* page already gone */ });
  });

  // Open external (http/https) links in the user's default browser instead
  // of swapping out the app's own document.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const current = win.webContents.getURL();
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      event.preventDefault();
      shell.openExternal(url);
      return;
    }
    // Allow only same-file navigations (hash changes, etc.).
    if (!url.startsWith('file://') || (current && url.split('#')[0] !== current.split('#')[0])) {
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
