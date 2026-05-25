const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker } = require('electron');
const { randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');

let psbId = null;

// ... (rest of imports)

// ── Error Handling ───────────────────────────────────────────────────────────
function logError(type, err) {
  const msg = `[${type}] ${err?.stack || err}\n`;
  console.error(msg);
  try {
    const logPath = path.join(app.getPath('userData'), 'error.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}`);
  } catch (e) {}
}

process.on('uncaughtException', (err) => logError('Uncaught Exception', err));
process.on('unhandledRejection', (reason) => logError('Unhandled Rejection', reason));

// ── App ID for Windows ───────────────────────────────────────────────────────
if (process.platform === 'win32') {
  app.setAppUserModelId('com.tapcontroller.app');
}

// Remove default application menu
Menu.setApplicationMenu(null);

let mainWindow  = null;
let splashWindow = null;
let httpServer  = null;
let tunnelStop  = null;
let autoUpdater = null;
let config = { port: 7777 };
let port = 7777;
let CONFIG_PATH = '';
let APP_VERSION = '';

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
  splashWindow.loadFile(path.join(__dirname, 'src/splash/index.html'));
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

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
}

// ── Version Comparison Helper ────────────────────────────────────────────────
function isNewer(current, latest) {
  if (!latest) return false;
  const c = current.replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
  const l = latest.replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) {
    if (l[i] > (c[i] || 0)) return true;
    if (l[i] < (c[i] || 0)) return false;
  }
  return false;
}

// ── Update Logic ──────────────────────────────────────────────────────────────
function setupUpdaterListeners() {
  if (!autoUpdater) return;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...');
    emit('update-status', { type: 'checking' });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] Update not available:', info.version);
    emit('update-status', { type: 'none' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    if (!isNewer(APP_VERSION, info.version)) {
      console.log('[Updater] Same or older version found, ignoring.');
      emit('update-status', { type: 'none' });
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
    if (!isNewer(APP_VERSION, info.version)) {
      console.log('[Updater] Same or older version downloaded, ignoring.');
      emit('update-status', { type: 'none' });
      return;
    }
    emit('update-status', { type: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    emit('update-status', { type: 'error', message: err.message });
  });
}

ipcMain.handle('check-update', async () => {
  if (!app.isPackaged || !autoUpdater) return { ok: false, error: 'Updater not available' };
  try {
    await autoUpdater.checkForUpdatesAndNotify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
let isQuittingForUpdate = false;
let cleanupDone = false;

function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log('[App] Cleaning up services...');

  if (tunnelStop) {
    try { tunnelStop(); } catch (e) { console.error('[App] Tunnel stop error:', e); }
    tunnelStop = null;
  }

  try {
    const { stopTunnel } = require('./src/server/tunnel');
    stopTunnel();
  } catch (e) { console.error('[App] stopTunnel error:', e); }

  try {
    const { closeServer } = require('./src/server/server');
    closeServer();
  } catch (e) { console.error('[App] closeServer error:', e); }

  try {
    const { stopHelper } = require('./src/server/input');
    stopHelper();
  } catch (e) { console.error('[App] stopHelper error:', e); }

  console.log('[App] All services stopped.');
}

app.on('before-quit', () => {
  cleanup();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuittingForUpdate) {
    app.quit();
  }
});

ipcMain.on('restart-app', () => {
  console.log('[Updater] Restart requested. isPackaged:', app.isPackaged);
  isQuittingForUpdate = true;
  cleanup();

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
ipcMain.on('window-close', () => {
  cleanup();
  mainWindow?.close();
});

function emit(event, data) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

// ── App startup ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  psbId = powerSaveBlocker.start('prevent-app-suspension');
  console.log(`[App] Power save blocker started: ${psbId}`);
  
  APP_VERSION = app.getVersion();
  CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { console.error('Failed to load config:', e); }
  port = config.port;

  // Auto-Updater (Optional Dependency)
  try {
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;
    if (autoUpdater) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      setupUpdaterListeners();
    }
  } catch (e) {
    console.warn('[Updater] electron-updater not found or setup failed. Auto-updates disabled.');
  }

  createSplash();
  createMainWindow();

  // Register BEFORE any await so we never miss did-finish-load if page loads fast.
  mainWindow.webContents.once('did-finish-load', () => {
    if (port) sendServerReady();
    // Check for updates after UI is ready
    if (app.isPackaged && autoUpdater) {
      autoUpdater.checkForUpdatesAndNotify().catch(e => console.error('Update check failed:', e));
    }
  });

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

  // PREFETCH: Find a free port before starting
  const oldPort = port;
  port = await findFreePort(port);
  
  // If the port changed, persist it immediately
  if (port !== oldPort) {
    config.port = port;
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config)); } catch(e){}
  }

  httpServer = createServer(port, TOKEN, emit);
  console.log(`[server] Listening on port ${port}`);

  // After splash animation, close splash and reveal main window.
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    mainWindow.show();
    mainWindow.focus();
    sendServerReady(); // Ensure renderer is in sync after show
  }, 2500);
});

// ── Final Cleanup ─────────────────────────────────────────────────────────────
app.on('will-quit', (e) => {
  cleanup();
  // Safety net: force-exit after 3 s if any service hangs
  setTimeout(() => process.exit(0), 3000).unref();
});

function sendServerReady() {
  try {
    const ip = require('ip');
    const addr = ip.address() || '127.0.0.1';
    const localUrl = buildUrl(`http://${addr}:${port}`);
    emit('status', { type: 'server-ready', localUrl, port });
  } catch (err) {
    logError('sendServerReady', err);
    emit('status', { type: 'server-error', message: 'Failed to determine local IP address' });
  }
}

function buildUrl(base) {
  return `${base}/controller/?token=${TOKEN}`;
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
    const addr = ip.address() || '127.0.0.1';
    const localUrl = buildUrl(`http://${addr}:${port}`);
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
  const addr = ip.address() || '127.0.0.1';
  const localUrl = buildUrl(`http://${addr}:${port}`);
  emit('status', { type: 'server-ready', localUrl, port });
  return { ok: true };
});

// ── Misc IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-local-url', () => {
  const ip = require('ip');
  const addr = ip.address() || '127.0.0.1';
  return buildUrl(`http://${addr}:${port}`);
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
  const addr = ip.address() || '127.0.0.1';
  return { localUrl: buildUrl(`http://${addr}:${port}`), port, version: APP_VERSION };
});
