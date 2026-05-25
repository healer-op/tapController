const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');

// ── Unified App Version ───────────────────────────────────────────────────────
const APP_VERSION = app.getVersion();

// ── Auto-Updater (Optional Dependency) ────────────────────────────────────────
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
  if (autoUpdater) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  }
} catch (e) {
  console.warn('[Updater] electron-updater not found. Auto-updates disabled.');
}

// Remove default application menu
Menu.setApplicationMenu(null);

let mainWindow  = null;
let splashWindow = null;
let httpServer  = null;
let tunnelStop  = null;

// Load persisted configuration
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
let config = { port: 7777 };
try {
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
} catch (e) { console.error('Failed to load config:', e); }

let port = config.port;

// Auth token — embedded in QR URL, validated by WS server
const TOKEN = randomBytes(16).toString('hex');

// ── Splash window ─────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    skipTaskbar: true,
    icon: path.join(__dirname, 'src/assets/icologo.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile('src/splash/index.html');
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false, // Frameless for custom titlebar
    transparent: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'src/assets/icologo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile('src/renderer/index.html');
}

// ── Update Logic ──────────────────────────────────────────────────────────────
if (autoUpdater) {
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...');
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] Update not available:', info.version);
    emit('update-status', { type: 'none' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    if (info.version === APP_VERSION) {
      console.log('[Updater] Same version as running app, ignoring.');
      return;
    }
    emit('update-status', { type: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    console.log(`[Updater] Download progress: ${percent}%`);
    emit('update-status', { type: 'downloading', percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    emit('update-status', { type: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    emit('update-status', { type: 'error', message: err.message });
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
let isQuittingForUpdate = false;

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuittingForUpdate) {
    if (tunnelStop) tunnelStop();
    if (httpServer) httpServer.close();
    app.quit();
  }
});

ipcMain.on('restart-app', () => {
  console.log('[Updater] Restart requested. isPackaged:', app.isPackaged);
  isQuittingForUpdate = true;
  
  // Manual cleanup before abrupt exit
  if (tunnelStop) tunnelStop();
  if (httpServer) httpServer.close();
  const { stopHelper } = require('./src/server/input');
  stopHelper();

  if (autoUpdater) {
    try {
      console.log('[Updater] Calling quitAndInstall...');
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      console.error('[Updater] Failed to quitAndInstall:', err);
      app.relaunch();
      app.exit(0);
    }
  } else {
    console.warn('[Updater] autoUpdater not available, just relaunching.');
    app.relaunch();
    app.exit(0);
  }
});

// ── Window Controls IPC ───────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

function emit(event, data) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

// ── App startup ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();
  createMainWindow();

  // Check for updates during splash
  if (app.isPackaged && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify().catch(e => console.error('Update check failed:', e));
  }

  // Register BEFORE any await so we never miss did-finish-load if page loads fast.
  mainWindow.webContents.once('did-finish-load', () => sendServerReady());

  // Pipe renderer console to Node stdout
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  // F12 toggles DevTools
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  const { findFreePort } = require('./src/server/port-finder');
  const { createServer } = require('./src/server/server');
  const { handleInput, stopHelper } = require('./src/server/input');

  // Try to use the configured port first
  port       = await findFreePort(port);
  httpServer = createServer(port, TOKEN, emit);
  console.log(`[server] Listening on port ${port}`);

  // After splash animation, close splash and reveal main window.
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    mainWindow.show();
    mainWindow.focus();
  }, 2500);
});

// ── Final Cleanup ─────────────────────────────────────────────────────────────
app.on('will-quit', () => {
  console.log('[App] Quitting... Cleaning up tasks.');
  const { stopHelper } = require('./src/server/input');
  const { stopTunnel } = require('./src/server/tunnel');

  if (tunnelStop) {
    try { tunnelStop(); } catch (e) { console.error('Error stopping tunnel:', e); }
  } else {
    try { stopTunnel(); } catch (e) { console.error('Error stopping tunnel:', e); }
  }

  if (httpServer) {
    try { httpServer.close(); } catch (e) { console.error('Error closing server:', e); }
  }

  try { stopHelper(); } catch (e) { console.error('Error stopping helper:', e); }
});

function sendServerReady() {
  const ip = require('ip');
  const localUrl = buildUrl(`http://${ip.address()}:${port}`);
  emit('status', { type: 'server-ready', localUrl, port });
}

function buildUrl(base) {
  return `${base}/controller?token=${TOKEN}`;
}

// ── Port Persistence ──────────────────────────────────────────────────────────
ipcMain.handle('save-port', async (event, newPort) => {
  try {
    config.port = parseInt(newPort);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Tunnel IPC (user-initiated) ───────────────────────────────────────────────
ipcMain.handle('start-tunnel', async () => {
  const { startTunnel } = require('./src/server/tunnel');
  try {
    const { url, stop } = await startTunnel(port);
    tunnelStop = stop;
    const ip = require('ip');
    const localUrl = buildUrl(`http://${ip.address()}:${port}`);
    emit('status', { type: 'tunnel-ready', tunnelUrl: buildUrl(url.replace(/\/$/, '')), localUrl });
    return { ok: true, url: buildUrl(url.replace(/\/$/, '')) };
  } catch (err) {
    emit('status', { type: 'tunnel-error', message: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('stop-tunnel', () => {
  if (tunnelStop) { tunnelStop(); tunnelStop = null; }
  const ip = require('ip');
  const localUrl = buildUrl(`http://${ip.address()}:${port}`);
  emit('status', { type: 'server-ready', localUrl, port });
  return { ok: true };
});

// ── Misc IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-local-url', () => {
  const ip = require('ip');
  return buildUrl(`http://${ip.address()}:${port}`);
});

ipcMain.handle('get-token', () => TOKEN);

ipcMain.handle('set-admin', (e, id) => {
  const { setAdmin } = require('./src/server/server');
  setAdmin(id);
});

ipcMain.handle('get-admin', () => {
  const { getAdmin } = require('./src/server/server');
  return getAdmin();
});

// Pull-based: renderer calls this on load to get current server state
ipcMain.handle('get-server-info', () => {
  if (!port) return null;
  const ip = require('ip');
  return { localUrl: buildUrl(`http://${ip.address()}:${port}`), port, version: APP_VERSION };
});
