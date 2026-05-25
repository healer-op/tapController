'use strict';

// ── Window Controls ───────────────────────────────────────────────────────────
document.getElementById('win-close').addEventListener('click', () => window.api.windowClose());
document.getElementById('win-min').addEventListener('click',   () => window.api.windowMinimize());
document.getElementById('win-max').addEventListener('click',   () => window.api.windowMaximize());

// ── Privacy Blur ─────────────────────────────────────────────────────────────
document.querySelectorAll('.privacy-blur').forEach(el => {
  el.addEventListener('click', () => el.classList.add('revealed'));
});

// ── Port Configuration ────────────────────────────────────────────────────────
const portInput = document.getElementById('port-input');
const savePortBtn = document.getElementById('save-port-btn');

savePortBtn.addEventListener('click', async () => {
  const newPort = portInput.value;
  if (!newPort || newPort < 1024 || newPort > 65535) {
    alert('Invalid port (1024-65535)');
    return;
  }
  const res = await window.api.savePort(newPort);
  if (res.ok) {
    savePortBtn.textContent = '✓';
    setTimeout(() => savePortBtn.textContent = '💾', 1500);
  } else {
    alert('Failed to save port: ' + res.error);
  }
});

// ── Update Management ─────────────────────────────────────────────────────────
const updateBanner = document.getElementById('update-banner');
const restartBtn   = document.getElementById('restart-app-btn');
const updateMsg    = updateBanner?.querySelector('.update-msg');

window.api.onUpdateStatus((data) => {
  if (data.type === 'available' || data.type === 'ready') {
    updateBanner.classList.remove('hidden');
    if (data.type === 'ready') {
      if (updateMsg) updateMsg.textContent = `Version ${data.version || ''} is ready!`;
      restartBtn.textContent = 'Restart to Update';
      restartBtn.disabled = false;
    } else {
      if (updateMsg) updateMsg.textContent = `Downloading v${data.version || ''}...`;
      restartBtn.textContent = 'Downloading...';
      restartBtn.disabled = true;
    }
  } else if (data.type === 'none' || data.type === 'error') {
    updateBanner.classList.add('hidden');
  }
});

restartBtn.addEventListener('click', () => window.api.restartApp());

// ── Element refs ──────────────────────────────────────────────────────────────
const qrImg             = document.getElementById('qr-img');
const qrHolder          = document.getElementById('qr-placeholder');
const qrPlaceholderText = document.getElementById('qr-placeholder-text');
const statusBadge       = document.getElementById('status-badge');
const tunnelUrlEl       = document.getElementById('tunnel-url');
const localUrlEl        = document.getElementById('local-url');
const clientList        = document.getElementById('client-list');
const countBadge        = document.getElementById('player-count');
const portVal           = document.getElementById('port-val');
const tunnelModal       = document.getElementById('tunnel-modal');
const tunnelBtn         = document.getElementById('tunnel-toggle-btn');
const tunnelBtnLabel    = document.getElementById('tunnel-btn-label');
const tunnelBtnIcon     = document.querySelector('.tunnel-btn-icon');
const tunnelStatus      = document.getElementById('tunnel-status');

const AVATAR_COLORS = ['#7c6af7','#4ecdc4','#ff6b6b','#ffd93d','#6bcb77','#f8a5c2','#a29bfe','#fd79a8'];

// ── State ─────────────────────────────────────────────────────────────────────
let tunnelUrl    = null;
let localUrl     = null;
let qrMode       = 'internet';
let tunnelRunning = false;

// ── QR rendering ─────────────────────────────────────────────────────────────
async function renderQR(url) {
  if (!url) return;
  try {
    const dataUrl = await window.api.generateQR(url);
    qrImg.src = dataUrl;
    qrImg.style.display = 'block';
    qrHolder.style.display = 'none';
  } catch (err) {
    console.error('[QR] generation failed:', err);
    qrPlaceholderText.textContent = 'QR error — check DevTools';
  }
}

function refreshQR() {
  // Internet mode falls back to local URL when tunnel is not running
  const url = qrMode === 'internet' ? (tunnelUrl || localUrl) : localUrl;
  if (url) {
    renderQR(url);
  } else {
    qrPlaceholderText.textContent = 'Starting server...';
    qrImg.style.display = 'none';
    qrHolder.style.display = 'flex';
  }
}

// ── Status events ─────────────────────────────────────────────────────────────
function handleStatus(data) {
  switch (data.type) {
    case 'server-ready':
      localUrl = data.localUrl;
      localUrlEl.textContent = shorten(data.localUrl);
      localUrlEl.classList.add('url-value--active');
      portVal.textContent = data.port;
      statusBadge.textContent = 'Local Only';
      statusBadge.className   = 'badge badge--local';
      tunnelBtn.disabled = false;
      refreshQR();
      break;

    case 'tunnel-ready':
      tunnelUrl = data.tunnelUrl;
      localUrl  = data.localUrl;
      tunnelUrlEl.textContent = shorten(data.tunnelUrl);
      tunnelUrlEl.classList.add('url-value--active');
      localUrlEl.textContent  = shorten(data.localUrl);
      localUrlEl.classList.add('url-value--active');
      statusBadge.textContent = 'Online';
      statusBadge.className   = 'badge badge--ready';
      setTunnelRunning(true);
      refreshQR();
      break;

    case 'tunnel-error':
      statusBadge.textContent = 'Local Only';
      statusBadge.className   = 'badge badge--local';
      setTunnelRunning(false);
      showTunnelStatus('error', `Tunnel failed: ${data.message}`);
      break;
  }
}

window.api.onStatus(handleStatus);

// ── Tunnel modal & controls ───────────────────────────────────────────────────
tunnelBtn.addEventListener('click', () => {
  if (tunnelRunning) {
    stopTunnel();
  } else {
    tunnelModal.classList.remove('hidden');
  }
});

document.getElementById('tunnel-cancel').addEventListener('click', () => {
  tunnelModal.classList.add('hidden');
});

document.getElementById('tunnel-confirm').addEventListener('click', async () => {
  tunnelModal.classList.add('hidden');
  showTunnelStatus('connecting', 'Starting tunnel... this may take up to 30 s');
  tunnelBtn.disabled = true;
  tunnelBtnLabel.textContent = 'Connecting...';

  const res = await window.api.startTunnel();
  if (!res.ok) {
    showTunnelStatus('error', `Failed: ${res.error}`);
    tunnelBtn.disabled = false;
    tunnelBtnLabel.textContent = 'Open to Internet';
  }
  // Success is handled via 'tunnel-ready' status event
});

async function stopTunnel() {
  await window.api.stopTunnel();
  tunnelUrl = null;
  tunnelUrlEl.textContent = '—';
  tunnelUrlEl.classList.remove('url-value--active');
  setTunnelRunning(false);
  showTunnelStatus('', '');
  refreshQR();
}

function setTunnelRunning(running) {
  tunnelRunning = running;
  tunnelBtn.disabled = false;
  tunnelBtn.classList.toggle('tunnel-btn--stop', running);
  tunnelBtnIcon.textContent  = running ? '⛔' : '🌐';
  tunnelBtnLabel.textContent = running ? 'Close Internet' : 'Open to Internet';
}

function showTunnelStatus(type, msg) {
  tunnelStatus.className = 'tunnel-status' + (type ? ` tunnel-status--${type}` : '') + (msg ? '' : ' hidden');
  tunnelStatus.textContent = msg;
}

// ── QR tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('tab-btn--active'));
    btn.classList.add('tab-btn--active');
    qrMode = btn.dataset.mode;
    refreshQR();
  });
});

// ── Copy buttons ──────────────────────────────────────────────────────────────
document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const el   = document.getElementById(btn.dataset.target);
    const text = el?.dataset.full || el?.textContent || '';
    if (!text || text === '—') return;
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied'); btn.textContent = '✓';
      setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '⧉'; }, 1500);
    });
  });
});

// ── Connected clients ─────────────────────────────────────────────────────────
const connectedClients = new Map();
let currentAdminId = null;

window.api.onClientEvent((data) => {
  if (data.type === 'admin-changed') {
    currentAdminId = data.adminId;
    rebuildList();
  } else if (data.type === 'slots-changed') {
    for (const slotInfo of data.slots || []) {
      const c = connectedClients.get(slotInfo.clientId);
      if (c) {
        c.slot = slotInfo.slot;
        c.controllerId = `P${slotInfo.slot}`;
      }
    }
    currentAdminId = data.slots?.find((slotInfo) => slotInfo.slot === 1)?.clientId || null;
    rebuildList();
  } else if (data.type === 'connected') {
    connectedClients.set(data.id, {
      name: data.name,
      id: data.id,
      slot: data.slot,
      controllerId: data.controllerId,
      lastInput: '',
    });
    window.api.getAdmin().then(id => { currentAdminId = id; rebuildList(); });
  } else if (data.type === 'disconnected') {
    connectedClients.delete(data.id);
    rebuildList();
  } else if (data.type === 'renamed') {
    const c = connectedClients.get(data.id);
    if (c) { c.name = data.name; rebuildList(); }
  } else if (data.type === 'input') {
    const c = connectedClients.get(data.id);
    if (c && data.data) {
      if (data.data.type === 'button') {
        c.lastInput = data.data.pressed ? `[${data.data.id.toUpperCase()}]` : '';
      } else if (data.data.type === 'axis' || data.data.type === 'gyro') {
        c.lastInput = '⟵ ⟶';
      } else if (data.data.type === 'trigger') {
        c.lastInput = data.data.value > 0 ? `[${data.data.id.toUpperCase()} ${(data.data.value*100).toFixed(0)}%]` : '';
      }
      updateClientInput(data.id, c.lastInput);
    }
  }
});

function updateClientInput(id, inputStr) {
  const el = document.getElementById(`client-input-${id}`);
  if (el) {
    el.textContent = inputStr;
    el.classList.remove('flash');
    void el.offsetWidth; // trigger reflow
    if (inputStr) el.classList.add('flash');
  }
}

function rebuildList() {
  countBadge.textContent = connectedClients.size;
  if (!connectedClients.size) {
    clientList.innerHTML = '<li class="client-empty">No players yet.<br>Scan the QR code to join.</li>';        
    return;
  }
  clientList.innerHTML = '';
  const sortedClients = Array.from(connectedClients.values())
    .sort((a, b) => (a.slot || 99) - (b.slot || 99));

  for (const c of sortedClients) {
    const slot = c.slot || 0;
    const color = AVATAR_COLORS[(slot ? slot - 1 : 0) % AVATAR_COLORS.length];
    const isAdmin = (c.id === currentAdminId) || slot === 1;
    
    const adminHtml = isAdmin 
      ? `<div class="slot-badge slot-badge--p1">P1</div>`
      : `<button class="admin-btn" data-id="${c.id}">Make P1</button>`;

    const li = document.createElement('li');
    li.className = 'client-item';
    li.innerHTML = `
      <div class="client-avatar" style="background:${color}22;color:${color}">${(c.name||'P')[0].toUpperCase()}</div>
      <div class="client-info">
        <div class="client-name">${esc(c.name)}</div>
        <div class="client-sub">Controller ${c.controllerId || 'P' + slot} <span id="client-input-${c.id}" class="client-input-display" style="color: #4ecdc4; margin-left: 8px; font-weight: bold; transition: opacity 0.1s;"></span></div>
      </div>
      ${adminHtml}`;
    clientList.appendChild(li);
  }

  document.querySelectorAll('.admin-btn').forEach(btn => {
    btn.addEventListener('click', () => window.api.setAdmin(btn.dataset.id));
  });
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return s.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function shorten(url) {
  // Store full URL as data attribute for copy buttons
  const el = document.getElementById(
    url === tunnelUrl || url?.includes('trycloudflare') ? 'tunnel-url' : 'local-url'
  );
  if (el) el.dataset.full = url;
  try {
    const u = new URL(url);
    return u.hostname + (u.port ? ':' + u.port : '');
  } catch { return url; }
}

// ── Init: pull server info on load ──────────────────────────────────────────
window.api.getServerInfo().then((info) => {
  if (info?.localUrl) {
    handleStatus({ type: 'server-ready', localUrl: info.localUrl, port: info.port });
    if (portInput) portInput.value = info.port;
    if (info.version) {
      const versionEl = document.querySelector('.about-version');
      if (versionEl) versionEl.textContent = `v${info.version}`;
    }
  }
});

window.api.getAdmin().then(id => {
  currentAdminId = id;
  rebuildList();
});

// ── About modal ───────────────────────────────────────────────────────────────
const aboutModal = document.getElementById('about-modal');
document.getElementById('about-btn').addEventListener('click', () => {
  aboutModal.classList.remove('hidden');
});
document.getElementById('about-close').addEventListener('click', () => {
  aboutModal.classList.add('hidden');
});
aboutModal.addEventListener('click', (e) => {
  if (e.target === aboutModal) aboutModal.classList.add('hidden');
});
