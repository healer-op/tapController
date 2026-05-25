const { Tunnel } = require('cloudflared');
const { use } = require('cloudflared/lib/constants');
const { app } = require('electron');
const path = require('path');

if (app && app.isPackaged) {
  const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const binPath = path.join(process.resourcesPath, 'bin', exeName);
  use(binPath);
}

let activeTunnel = null;

/**
 * Start a cloudflared quick tunnel pointing at the local port.
 * Returns { url, stop } when the tunnel URL is ready.
 */
function startTunnel(port) {
  return new Promise((resolve, reject) => {
    const t = Tunnel.quick(`http://localhost:${port}`);
    activeTunnel = t;

    const timer = setTimeout(() => {
      t.stop();
      reject(new Error('Tunnel startup timed out after 60 s'));
    }, 60_000);

    t.once('url', (url) => {
      clearTimeout(timer);
      resolve({
        url,
        stop: () => {
          t.stop();
          activeTunnel = null;
        },
      });
    });

    t.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    t.process.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        reject(new Error(`cloudflared exited with code ${code}`));
      }
    });
  });
}

function stopTunnel() {
  if (activeTunnel) {
    activeTunnel.stop();
    activeTunnel = null;
  }
}

module.exports = { startTunnel, stopTunnel };
