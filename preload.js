const { contextBridge, ipcRenderer } = require('electron');

// Load only the minimal qrcode internals — avoids server.js which pulls in pngjs
const QRCodeCore = require('qrcode/lib/core/qrcode');
const SvgRenderer = require('qrcode/lib/renderer/svg-tag');

function buildSvgDataUrl(url) {
  const qrData = QRCodeCore.create(url, { errorCorrectionLevel: 'M' });
  const svg    = SvgRenderer.render(qrData, {
    margin: 4, width: 300,
    color: { dark: '#0d0d1a', light: '#ffffff' },
  });
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

contextBridge.exposeInMainWorld('api', {
  // Status & client events
  onStatus:      (cb) => ipcRenderer.on('status',       (_, d) => cb(d)),
  onClientEvent: (cb) => ipcRenderer.on('client-event', (_, d) => cb(d)),

  // Auth
  getAuth:       ()    => ipcRenderer.invoke('get-auth'),
  logout:        ()    => ipcRenderer.invoke('logout'),
  openLogin:     ()    => ipcRenderer.invoke('open-login'),
  parseAuthUrl:  (url) => ipcRenderer.invoke('parse-auth-url', url),
  onAuthUpdate:  (cb)  => ipcRenderer.on('auth-update', (_, d) => cb(d)),
  onAuthError:   (cb)  => ipcRenderer.on('auth-error',  (_, d) => cb(d)),
  openExternal:  (url) => ipcRenderer.invoke('open-external', url),

  // Discord RPC
  updateRpc: (opts) => ipcRenderer.invoke('update-rpc', opts),

  // Queries
  getLocalUrl: () => ipcRenderer.invoke('get-local-url'),
  getToken:    () => ipcRenderer.invoke('get-token'),
  getAdmin:    () => ipcRenderer.invoke('get-admin'),
  setAdmin:    (id) => ipcRenderer.invoke('set-admin', id),

  // QR — synchronous SVG, wrapped in a Promise for the renderer's await
  generateQR: (url) => {
    try   { return Promise.resolve(buildSvgDataUrl(url)); }
    catch (e) { return Promise.reject(e); }
  },

  // Pull server state on load
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),

  // Tunnel control
  startTunnel: () => ipcRenderer.invoke('start-tunnel'),
  stopTunnel:  () => ipcRenderer.invoke('stop-tunnel'),

  // Window management
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose:    () => ipcRenderer.send('window-close'),

  // Port management
  savePort: (port) => ipcRenderer.invoke('save-port', port),

  // Update management
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, d) => cb(d)),
  restartApp:     () => ipcRenderer.send('restart-app'),
  checkUpdate:    () => ipcRenderer.invoke('check-update'),

  // Logs
  onAppLog: (cb) => ipcRenderer.on('app-log', (_, d) => cb(d)),
});
