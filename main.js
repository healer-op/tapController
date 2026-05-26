const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, shell } = require('electron');
const { randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');

let DiscordRPC;
try { DiscordRPC = require('discord-rpc'); } catch(e) { console.warn('[RPC] discord-rpc not available'); }

const DISCORD_CLIENT_ID = '1508902531219062965';
const MY_GUILD_ID = '972722436971855933';

let psbId = null;

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
let AUTH_FILE   = '';
let APP_VERSION = '';

// Auth token — embedded in QR URL, validated by WS server
const TOKEN = randomBytes(16).toString('hex');

// ── Discord RPC ───────────────────────────────────────────────────────────────
let rpc = null;
let rpcReady = false;

function initRPC() {
  if (!DiscordRPC) return;
  try {
    DiscordRPC.register(DISCORD_CLIENT_ID);
    rpc = new DiscordRPC.Client({ transport: 'ipc' });
    rpc.on('ready', () => {
      rpcReady = true;
      updateRpcPresence({ details: 'In App', state: 'Ready to play' });
    });
    rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {});
  } catch(e) { console.error('[RPC] Init error:', e); }
}

function updateRpcPresence(opts = {}) {
  if (!rpcReady || !rpc) return;
  try {
    rpc.setActivity({
      details: opts.details || 'In App',
      state: opts.state || 'Idle',
      largeImageKey: 'logo',
      largeImageText: 'TapController',
      instance: false,
      buttons: [{ label: 'Download TapController', url: 'https://github.com/HEALER07/tapController/releases/latest' }]
    }).catch(() => {});
  } catch(e) {}
}

// ── Auth (Discord OAuth) ──────────────────────────────────────────────────────
async function handleAuthUrl(url) {
  try {
    const stripped = url.replace(/^tapcontroller:\/\//i, '').replace(/\/$/, '');
    if (!stripped.startsWith('token/')) return null;

    const accessToken = stripped.replace('token/', '');

    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) throw new Error('Failed to fetch Discord profile');
    const userData = await userRes.json();

    const memberRes = await fetch(`https://discord.com/api/v10/users/@me/guilds/${MY_GUILD_ID}/member`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });

    if (memberRes.status === 404) {
      emit('auth-error', { reason: 'not_in_server' });
      return null;
    }

    if (!memberRes.ok) {
      emit('auth-error', { reason: 'member_check_failed', status: memberRes.status });
      return null;
    }

    const memberData = await memberRes.json();
    const userRoles = memberData.roles || [];

    const avatar = userData.avatar
      ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${Number(userData.discriminator || 0) % 5}.png`;

    const authData = {
      userId: userData.id,
      username: userData.username,
      globalName: userData.global_name || userData.username,
      avatar,
      roles: userRoles,
      expiry: Date.now() + (2 * 24 * 60 * 60 * 1000),
      loginTime: Date.now()
    };

    if (AUTH_FILE) fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2));
    emit('auth-update', authData);
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    updateRpcPresence({ details: `Playing as ${authData.globalName}`, state: 'In App' });
    return authData;
  } catch(e) {
    console.error('[Auth] Exception:', e);
    return null;
  }
}

// ── Protocol & Single Instance ────────────────────────────────────────────────
app.setAsDefaultProtocolClient('tapcontroller');

app.on('open-url', (e, url) => { e.preventDefault(); handleAuthUrl(url); });

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find(a => /^tapcontroller:\/\//i.test(a));
    if (url) handleAuthUrl(url);
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  });
}

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
    frame: false,
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
      emit('update-status', { type: 'none' });
      return;
    }
    emit('update-status', { type: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    emit('update-status', { type: 'downloading', percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    if (!isNewer(APP_VERSION, info.version)) {
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
    try { tunnelStop(); } catch (e) {}
    tunnelStop = null;
  }

  try { const { stopTunnel } = require('./src/server/tunnel'); stopTunnel(); } catch (e) {}
  try { const { closeServer } = require('./src/server/server'); closeServer(); } catch (e) {}
  try { const { stopHelper } = require('./src/server/input'); stopHelper(); } catch (e) {}

  if (rpc) { try { rpc.destroy(); } catch(e) {} rpc = null; }

  console.log('[App] All services stopped.');
}

app.on('before-quit', () => { cleanup(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuittingForUpdate) {
    app.quit();
  }
});

ipcMain.on('restart-app', () => {
  isQuittingForUpdate = true;
  cleanup();
  if (autoUpdater) {
    try { autoUpdater.quitAndInstall(false, true); } catch (err) { app.relaunch(); app.exit(0); }
  } else {
    app.relaunch(); app.exit(0);
  }
});

// ── Window Controls IPC ───────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => { cleanup(); mainWindow?.close(); });

function emit(event, data) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

// ── App startup ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  psbId = powerSaveBlocker.start('prevent-app-suspension');

  APP_VERSION = app.getVersion();
  CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  AUTH_FILE   = path.join(app.getPath('userData'), 'tc-auth.json');

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { console.error('Failed to load config:', e); }
  port = config.port;

  // Auto-Updater
  try {
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;
    if (autoUpdater) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      setupUpdaterListeners();
    }
  } catch (e) {
    console.warn('[Updater] electron-updater not available. Auto-updates disabled.');
  }

  createSplash();
  createMainWindow();

  mainWindow.webContents.once('did-finish-load', () => {
    if (port) sendServerReady();
    if (app.isPackaged && autoUpdater) {
      autoUpdater.checkForUpdatesAndNotify().catch(e => console.error('Update check failed:', e));
    }
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  const { findFreePort } = require('./src/server/port-finder');
  const { createServer } = require('./src/server/server');

  const oldPort = port;
  port = await findFreePort(port);

  if (port !== oldPort) {
    config.port = port;
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config)); } catch(e){}
  }

  httpServer = createServer(port, TOKEN, emit);
  console.log(`[server] Listening on port ${port}`);

  // Handle protocol URL from first-instance launch
  const protocolUrl = process.argv.find(a => /^tapcontroller:\/\//i.test(a));
  if (protocolUrl) setTimeout(() => handleAuthUrl(protocolUrl), 1200);

  initRPC();

  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    mainWindow.show();
    mainWindow.focus();
    sendServerReady();
  }, 2500);
});

// ── Final Cleanup ─────────────────────────────────────────────────────────────
app.on('will-quit', () => {
  cleanup();
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

// ── Auth IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-auth', () => {
  try {
    const a = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (Date.now() > a.expiry) { try { fs.unlinkSync(AUTH_FILE); } catch {} return null; }
    return a;
  } catch { return null; }
});

ipcMain.handle('logout', () => {
  try { fs.unlinkSync(AUTH_FILE); } catch {}
  updateRpcPresence({ details: 'In App', state: 'Ready to play' });
  return true;
});

ipcMain.handle('open-login', () => {
  shell.openExternal('https://login.healer.eu.org/?req=tapController');
  return true;
});

ipcMain.handle('open-external', (_e, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    shell.openExternal(url);
    return true;
  } catch { return false; }
});

ipcMain.handle('parse-auth-url', (_e, url) => handleAuthUrl(url));

ipcMain.handle('update-rpc', (_e, opts) => { updateRpcPresence(opts); return true; });

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

// ── Tunnel IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('start-tunnel', async () => {
  const { startTunnel } = require('./src/server/tunnel');
  try {
    const { url, stop } = await startTunnel(port);
    tunnelStop = stop;
    const ip = require('ip');
    const addr = ip.address() || '127.0.0.1';
    const localUrl = buildUrl(`http://${addr}:${port}`);
    emit('status', { type: 'tunnel-ready', tunnelUrl: buildUrl(url.replace(/\/$/, '')), localUrl });
    updateRpcPresence({ details: 'Hosting a session', state: 'Internet Tunnel Active' });
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
  updateRpcPresence({ details: 'In App', state: 'Ready to play' });
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

ipcMain.handle('get-server-info', () => {
  if (!port) return null;
  const ip = require('ip');
  const addr = ip.address() || '127.0.0.1';
  return { localUrl: buildUrl(`http://${addr}:${port}`), port, version: APP_VERSION };
});
