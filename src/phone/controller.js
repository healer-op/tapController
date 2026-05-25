'use strict';

// ── Funny animal names ────────────────────────────────────────────────────────
const FUNNY_ANIMALS = [
  ['🐔', 'Lazy Chicken'],    ['🦒', 'Giant Giraffe'],   ['🐼', 'Sleepy Panda'],
  ['🦭', 'Dramatic Seal'],   ['🦛', 'Chonky Hippo'],    ['🐧', 'Confused Penguin'],
  ['🦆', 'Angry Duck'],      ['🐨', 'Derpy Koala'],     ['🦦', 'Sneaky Otter'],
  ['🐸', 'Tiny Frog'],       ['🦔', 'Spiky Hedgehog'],  ['🐢', 'Speedy Turtle'],
  ['🦩', 'Extra Flamingo'],  ['🐻', 'Dramatic Bear'],   ['🐡', 'Round Fish'],
  ['🦜', 'Loud Parrot'],     ['🐙', 'Wobbly Octopus'],  ['🦊', 'Sneaky Fox'],
  ['🐯', 'Grumpy Tiger'],    ['🦁', 'Sleepy Lion'],     ['🦝', 'Trash Panda'],
  ['🦌', 'Fancy Deer'],      ['🐺', 'Howling Wolf'],    ['🐻‍❄️', 'Chill Polar Bear'],
];

function randomFunnyName() {
  const [emoji, name] = FUNNY_ANIMALS[Math.floor(Math.random() * FUNNY_ANIMALS.length)];
  return `${emoji} ${name}`;
}

// ── Config (persisted) ────────────────────────────────────────────────────────
const cfg = {
  name:    localStorage.getItem('tc_name')    || '',
  mode:    'gamepad',
  gyro:    localStorage.getItem('tc_gyro')    === '1',
  haptic:  localStorage.getItem('tc_haptic')  !== '0',
  consent: localStorage.getItem('tc_consent') === '1',
  scale:   parseFloat(localStorage.getItem('tc_scale')) || 1.0,
  pos:     localStorage.getItem('tc_pos') || 'default',
  layout:  readSavedLayout(),
};

function applyLayout() {
  const ctrl = document.getElementById('controller');
  const hasCustomLayout = Object.keys(cfg.layout).length > 0;
  ctrl.style.transform = hasCustomLayout ? '' : `scale(${cfg.scale})`;
  ctrl.style.transformOrigin = 'center center';
  
  // Handle position classes
  ctrl.classList.remove('pos-default', 'pos-centered', 'pos-bottom');
  ctrl.classList.add(`pos-${cfg.pos}`);

  ctrl.classList.toggle('custom-layout', hasCustomLayout);
  applyControlLayout();
}

const LAYOUT_KEY = 'tc_button_layout';
const CONTROL_LABELS = {
  lt: 'LT', lb: 'LB', back: 'Back', guide: 'Guide', start: 'Start', rb: 'RB', rt: 'RT',
  dpad_up: 'D-Pad Up', dpad_left: 'D-Pad Left', dpad_right: 'D-Pad Right', dpad_down: 'D-Pad Down',
  left_stick: 'Left Stick', right_stick: 'Right Stick', y: 'Y', x: 'X', b: 'B', a: 'A',
};
let layoutEditing = false;
let selectedControl = null;
let layoutControls = [];

function readSavedLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem('tc_button_layout') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveControlLayout() {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(cfg.layout));
}

function clampPercent(value) {
  return Math.max(3, Math.min(97, value));
}

function controlIdFor(el) {
  if (el.id === 'left-stick-zone') return 'left_stick';
  if (el.id === 'right-stick-zone') return 'right_stick';
  return el.dataset.id;
}

function setupLayoutControls() {
  layoutControls = Array.from(document.querySelectorAll('[data-id], .stick-zone'))
    .filter((el) => !el.classList.contains('dpad-center'));

  layoutControls.forEach((el) => {
    const id = controlIdFor(el);
    if (!id) return;
    el.dataset.layoutId = id;
    el.classList.add('layout-control');
    setupControlDrag(el, id);
  });

  document.getElementById('selected-control-scale').addEventListener('input', (e) => {
    if (!selectedControl) return;
    const id = selectedControl.dataset.layoutId;
    ensureLayoutForControl(selectedControl, id);
    cfg.layout[id].scale = parseFloat(e.target.value);
    applyControlLayout();
    saveControlLayout();
  });
}

function ensureLayoutForControl(el, id) {
  if (cfg.layout[id]) return;
  const r = el.getBoundingClientRect();
  cfg.layout[id] = {
    x: clampPercent(((r.left + r.width / 2) / window.innerWidth) * 100),
    y: clampPercent(((r.top + r.height / 2) / window.innerHeight) * 100),
    scale: cfg.scale,
  };
}

function ensureFullLayout() {
  layoutControls.forEach((el) => {
    const id = el.dataset.layoutId;
    if (id) ensureLayoutForControl(el, id);
  });
  saveControlLayout();
}

function applyControlLayout() {
  layoutControls.forEach((el) => {
    const item = cfg.layout[el.dataset.layoutId];
    if (!item) {
      el.style.removeProperty('--layout-x');
      el.style.removeProperty('--layout-y');
      el.style.removeProperty('--layout-scale');
      return;
    }
    el.style.setProperty('--layout-x', item.x);
    el.style.setProperty('--layout-y', item.y);
    el.style.setProperty('--layout-scale', item.scale || 1);
  });
}

function selectControl(el) {
  if (selectedControl) selectedControl.classList.remove('selected-control');
  selectedControl = el;
  selectedControl.classList.add('selected-control');
  const id = selectedControl.dataset.layoutId;
  const item = cfg.layout[id];
  document.getElementById('selected-control-label').textContent = CONTROL_LABELS[id] || id;
  document.getElementById('selected-control-scale').value = item?.scale || 1;
}

function setupControlDrag(el, id) {
  let dragging = false;

  el.addEventListener('pointerdown', (e) => {
    if (!layoutEditing) return;
    e.preventDefault();
    e.stopPropagation();
    ensureLayoutForControl(el, id);
    selectControl(el);
    dragging = true;
    el.setPointerCapture(e.pointerId);
  }, true);

  el.addEventListener('pointermove', (e) => {
    if (!layoutEditing || !dragging) return;
    e.preventDefault();
    e.stopPropagation();
    cfg.layout[id].x = clampPercent((e.clientX / window.innerWidth) * 100);
    cfg.layout[id].y = clampPercent((e.clientY / window.innerHeight) * 100);
    applyControlLayout();
  }, true);

  const stop = (e) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = false;
    saveControlLayout();
  };
  el.addEventListener('pointerup', stop, true);
  el.addEventListener('pointercancel', stop, true);
}

function startLayoutEditor() {
  saveSettings({ keepOpen: true });
  ensureFullLayout();
  applyLayout();
  layoutEditing = true;
  const ctrl = document.getElementById('controller');
  ctrl.classList.add('editing-layout');
  settingsPanel.classList.add('hidden');
  document.getElementById('layout-editor').classList.remove('hidden');
  selectControl(layoutControls[0]);
}

function stopLayoutEditor() {
  layoutEditing = false;
  document.getElementById('controller').classList.remove('editing-layout');
  document.getElementById('layout-editor').classList.add('hidden');
  if (selectedControl) selectedControl.classList.remove('selected-control');
  selectedControl = null;
  saveControlLayout();
}

function resetControlLayout() {
  cfg.layout = {};
  localStorage.removeItem(LAYOUT_KEY);
  stopLayoutEditor();
  applyLayout();
}

const STICK_MAX = 52;
const RECONNECT_MS = 2500;

// ── Consent screen ────────────────────────────────────────────────────────────
const consentScreen = document.getElementById('consent-screen');
const overlay       = document.getElementById('overlay');

function showConsent() {
  consentScreen.classList.remove('hidden');
  overlay.classList.add('hidden');
}

function agreeConsent() {
  cfg.consent = true;
  localStorage.setItem('tc_consent', '1');
  if (!cfg.name) {
    cfg.name = randomFunnyName();
    localStorage.setItem('tc_name', cfg.name);
  }
  consentScreen.classList.add('hidden');
  overlay.classList.remove('hidden');
  initConnection();
}

document.getElementById('consent-agree').addEventListener('click', agreeConsent);

// ── Connection ────────────────────────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;
let connected = false;

const overlayIcon  = document.getElementById('overlay-icon');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub   = document.getElementById('overlay-sub');

// Extract auth token from page URL (embedded by QR code)
const TOKEN = new URLSearchParams(location.search).get('token') || '';

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/?token=${encodeURIComponent(TOKEN)}`;
}

function initConnection() {
  setOverlay('🎮', 'Connecting...', 'Please wait');
  overlay.classList.remove('hidden');
  connect();
}

function connect() {
  clearTimeout(reconnectTimer);
  if (!TOKEN) {
    setOverlay('🔐', 'No Token', 'Scan the QR code from TapController to connect.');
    return;
  }

  ws = new WebSocket(getWsUrl());

  ws.addEventListener('open', () => {
    connected = true;
    overlay.classList.add('hidden');
    if (cfg.name) send({ type: 'name', value: cfg.name });
    if (cfg.gyro) requestGyro();
  });

  ws.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'welcome' && !cfg.name) {
        cfg.name = msg.name || randomFunnyName();
        localStorage.setItem('tc_name', cfg.name);
        document.getElementById('player-name').value = cfg.name;
      }
    } catch (_) {}
  });

  ws.addEventListener('close', (e) => {
    connected = false;
    if (e.code === 4001 || e.code === 1008) {
      // Unauthorized — bad token
      setOverlay('🚫', 'Unauthorized', 'Token mismatch. Scan the QR code again.');
      return;
    }
    setOverlay('🔌', 'Disconnected', 'Reconnecting...');
    overlay.classList.remove('hidden');
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });

  ws.addEventListener('error', () => ws.close());
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...obj, mode: cfg.mode }));
  }
}

function setOverlay(icon, title, sub) {
  overlayIcon.textContent  = icon;
  overlayTitle.textContent = title;
  overlaySub.textContent   = sub;
}

// ── Gyro & Motion Handler ─────────────────────────────────────────────────────
class MotionHandler {
  constructor() {
    this.active = false;
    this.gyroActive = false;
    this.accelSign = 1; // Correction for non-iOS devices
    
    // Smoothed values
    this.smoothAccel = { x: 0, y: 0, z: 0 };
    this.smoothing = 0.4;
    
    this.boundHandleMotion = this.handleMotion.bind(this);
    this.boundHandleOrientation = this.handleOrientation.bind(this);
  }

  async requestPermission() {
    if (!cfg.gyro) return false;
    
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res === 'granted') return this.enable();
      } else {
        return this.enable();
      }
    } catch (e) {
      console.error('Motion permission failed:', e);
    }
    return false;
  }

  enable() {
    if (this.gyroActive) return true;
    
    // Detect iOS for sign correction
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    this.accelSign = isIOS ? 1 : -1;

    window.addEventListener('devicemotion', this.boundHandleMotion);
    window.addEventListener('deviceorientation', this.boundHandleOrientation);
    this.gyroActive = true;
    return true;
  }

  disable() {
    window.removeEventListener('devicemotion', this.boundHandleMotion);
    window.removeEventListener('deviceorientation', this.boundHandleOrientation);
    this.gyroActive = false;
    this.smoothAccel = { x: 0, y: 0, z: 0 };
    send({ type: 'axis', id: 'right', x: 0, y: 0 });
  }

  handleMotion(e) {
    if (!cfg.gyro || !connected) return;
    
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;

    // Apply low-pass filter
    const f = this.smoothing;
    const s = this.accelSign;
    this.smoothAccel.x = this.smoothAccel.x * f + (acc.x || 0) * s * (1 - f);
    this.smoothAccel.y = this.smoothAccel.y * f + (acc.y || 0) * s * (1 - f);
    this.smoothAccel.z = this.smoothAccel.z * f + (acc.z || 0) * s * (1 - f);
    
    this.processTilt();
  }

  handleOrientation(e) {
    // We primarily use devicemotion for tilt, but orientation can be used as fallback or for yaw
  }

  processTilt() {
    const { x, y, z } = this.smoothAccel;
    const g = 9.80665;
    
    // Normalize to gravity
    const nx = x / g;
    const ny = y / g;
    const nz = z / g;

    // Determine screen angle
    let angle = 0;
    if (window.screen?.orientation?.angle !== undefined) {
      angle = window.screen.orientation.angle;
    } else if (window.orientation !== undefined) {
      angle = window.orientation;
    }

    // Map to controller axes based on orientation
    let steering = 0; // Left/Right tilt
    let pitch = 0;    // Forward/Back tilt

    switch (angle) {
      case 90:  // Landscape Left
        steering = ny;
        pitch = -nx;
        break;
      case -90: // Landscape Right
      case 270:
        steering = -ny;
        pitch = nx;
        break;
      case 180: // Portrait Upside Down
        steering = -nx;
        pitch = -ny;
        break;
      case 0:   // Portrait
      default:
        steering = nx;
        pitch = ny;
        break;
    }

    // Clamp and apply deadzone
    const deadzone = 0.08;
    const sensitivity = 1.5;
    
    let outX = steering * sensitivity;
    let outY = (pitch - 0.5) * sensitivity; // Offset for natural holding angle

    outX = Math.max(-1, Math.min(1, Math.abs(outX) < deadzone ? 0 : outX));
    outY = Math.max(-1, Math.min(1, Math.abs(outY) < deadzone ? 0 : outY));

    send({ type: 'axis', id: 'right', x: outX, y: -outY });
  }
}

const motion = new MotionHandler();

// ── Haptic ────────────────────────────────────────────────────────────────────
function haptic(ms = 25) {
  if (cfg.haptic && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch(_) {}
  }
}

// ── Buttons ───────────────────────────────────────────────────────────────────
function setupButtons() {
  document.querySelectorAll('[data-id]').forEach((el) => {
    const id = el.dataset.id;
    if (el.classList.contains('stick-zone')) return;
    
    if (el.id === 'settings-trigger') {
      el.addEventListener('pointerdown', (e) => {
        if (!layoutEditing) {
          e.preventDefault();
          openSettings();
        }
      });
      return;
    }
    
    if (el.classList.contains('trigger-btn')) { 
      setupTrigger(el, id); 
      return; 
    }

    el.addEventListener('pointerdown', (e) => {
      if (layoutEditing) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      haptic(15);
      send({ type: 'button', id, pressed: true });
    });

    const up = (e) => {
      if (layoutEditing) return;
      el.classList.remove('pressed');
      send({ type: 'button', id, pressed: false });
    };

    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

function setupTrigger(el, id) {
  let startY = 0;
  let activePointerId = null;

  el.addEventListener('pointerdown', (e) => {
    if (layoutEditing || activePointerId !== null) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    startY = e.clientY;
    el.classList.add('pressed');
    haptic(15);
    
    // Send 100% on initial tap for immediate response, or just start at 0? 
    // Most users expect immediate response. Let's send 1.0 (100%) but allow dragging.
    // Actually, let's just send 0 on down, but update text immediately.
    el.textContent = id.toUpperCase() + ' 0%';
    send({ type: 'trigger', id, value: 0 });
  });

  el.addEventListener('pointermove', (e) => {
    if (layoutEditing || e.pointerId !== activePointerId) return;
    // Drag down to increase trigger value
    const dragDistance = 60; // pixels for 100%
    const v = Math.max(0, Math.min(1, (e.clientY - startY) / dragDistance));
    el.textContent = id.toUpperCase() + (v > 0.01 ? ` ${Math.round(v * 100)}%` : ' 0%');
    send({ type: 'trigger', id, value: v });
  });

  const up = (e) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    el.classList.remove('pressed');
    el.textContent = id.toUpperCase();
    send({ type: 'trigger', id, value: 0 });
  };

  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// ── Thumbstick ────────────────────────────────────────────────────────────────
function setupStick(zoneId, axisId, knobId) {
  const zone = document.getElementById(zoneId);
  const knob = document.getElementById(knobId);
  let pid = null, ox = 0, oy = 0;

  function center() {
    const r = zone.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  zone.addEventListener('pointerdown', (e) => {
    if (layoutEditing || pid !== null) return;
    e.preventDefault();
    zone.setPointerCapture(e.pointerId);
    pid = e.pointerId;
    ({ x: ox, y: oy } = center());
    zone.classList.add('active');
    haptic(12);
  });

  zone.addEventListener('pointermove', (e) => {
    if (layoutEditing || e.pointerId !== pid) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STICK_MAX) { dx = dx / dist * STICK_MAX; dy = dy / dist * STICK_MAX; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    send({ type: 'axis', id: axisId, x: dx / STICK_MAX, y: dy / STICK_MAX });
  });

  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    zone.classList.remove('active');
    knob.style.transform = 'translate(0,0)';
    send({ type: 'axis', id: axisId, x: 0, y: 0 });
  };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
}

// ── Settings ──────────────────────────────────────────────────────────────────
const settingsPanel = document.getElementById('settings-panel');

// ── Controller Modes ──────────────────────────────────────────────────────────
const CONTROLLER_TEMPLATES = {
  standard: `
    <div class="top-bar">
      <div class="trigger-group">
        <button class="trigger-btn" data-id="lt">LT</button>
        <button class="bumper-btn"  data-id="lb">LB</button>
      </div>
      <div class="center-buttons">
        <button class="sys-btn" data-id="back">⊟</button>
        <button class="guide-btn" data-id="guide" id="settings-trigger">⬤</button>
        <button class="sys-btn" data-id="start">⊞</button>
      </div>
      <div class="trigger-group">
        <button class="bumper-btn"  data-id="rb">RB</button>
        <button class="trigger-btn" data-id="rt">RT</button>
      </div>
    </div>
    <div class="bottom-area">
      <div class="left-zone">
        <div class="dpad">
          <button class="dpad-btn dpad-up"    data-id="dpad_up">▲</button>
          <button class="dpad-btn dpad-left"  data-id="dpad_left">◀</button>
          <div class="dpad-center"></div>
          <button class="dpad-btn dpad-right" data-id="dpad_right">▶</button>
          <button class="dpad-btn dpad-down"  data-id="dpad_down">▼</button>
        </div>
        <div class="stick-zone" id="left-stick-zone" data-id="thumb_left">
          <div class="stick-base"><div class="stick-knob" id="left-stick-knob"></div></div>
        </div>
      </div>
      <div class="right-zone">
        <div class="face-buttons">
          <div class="face-row"><button class="face-btn face-y" data-id="y">Y</button></div>
          <div class="face-row">
            <button class="face-btn face-x" data-id="x">X</button>
            <button class="face-btn face-b" data-id="b">B</button>
          </div>
          <div class="face-row"><button class="face-btn face-a" data-id="a">A</button></div>
        </div>
        <div class="stick-zone" id="right-stick-zone" data-id="thumb_right">
          <div class="stick-base"><div class="stick-knob" id="right-stick-knob"></div></div>
        </div>
      </div>
    </div>
  `,
  forza: `
    <div class="top-bar">
      <div class="center-buttons">
        <button class="sys-btn" data-id="back">SELECT</button>
        <button class="guide-btn" data-id="guide" id="settings-trigger">⬤</button>
        <button class="sys-btn" data-id="start">START</button>
      </div>
    </div>
    <div class="bottom-area">
      <div class="left-zone">
        <button class="trigger-btn" data-id="lt" style="width: 140px; height: 100px; margin-bottom: 20px;">BRAKE (LT)</button>
        <div class="face-buttons" style="flex-direction: row; gap: 20px;">
           <button class="face-btn face-y" data-id="y" style="width: 60px; height: 60px;">Y</button>
           <button class="face-btn face-x" data-id="x" style="width: 60px; height: 60px;">X</button>
        </div>
        <div class="stick-zone" id="left-stick-zone" data-id="thumb_left">
          <div class="stick-base"><div class="stick-knob" id="left-stick-knob"></div></div>
        </div>
      </div>
      <div class="right-zone">
        <button class="trigger-btn" data-id="rt" style="width: 140px; height: 100px; margin-bottom: 20px;">GAS (RT)</button>
        <div class="face-buttons" style="flex-direction: row; gap: 20px;">
           <button class="face-btn face-b" data-id="b" style="width: 60px; height: 60px;">B</button>
           <button class="face-btn face-a" data-id="a" style="width: 60px; height: 60px;">A</button>
        </div>
        <button class="bumper-btn" data-id="rb" style="width: 100px; height: 50px; margin-top: 10px;">CAM (RB)</button>
      </div>
    </div>
  `,
  ittakes: `
    <div class="top-bar">
      <div class="center-buttons">
        <button class="sys-btn" data-id="back">SELECT</button>
        <button class="guide-btn" data-id="guide" id="settings-trigger">⬤</button>
        <button class="sys-btn" data-id="start">START</button>
      </div>
    </div>
    <div class="bottom-area">
      <div class="left-zone">
        <div class="trigger-group" style="flex-direction: row; gap: 10px; margin-bottom: 20px;">
           <button class="trigger-btn" data-id="lt" style="width: 80px;">L2</button>
           <button class="bumper-btn"  data-id="lb" style="width: 80px;">L1</button>
        </div>
        <div class="stick-zone" id="left-stick-zone" data-id="thumb_left">
          <div class="stick-base"><div class="stick-knob" id="left-stick-knob"></div></div>
        </div>
      </div>
      <div class="right-zone">
        <div class="trigger-group" style="flex-direction: row-reverse; gap: 10px; margin-bottom: 20px;">
           <button class="trigger-btn" data-id="rt" style="width: 80px;">R2</button>
           <button class="bumper-btn"  data-id="rb" style="width: 80px;">R1</button>
        </div>
        <div class="face-buttons" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
           <button class="face-btn face-y" data-id="y">Y</button>
           <button class="face-btn face-b" data-id="b">B</button>
           <button class="face-btn face-x" data-id="x">X</button>
           <button class="face-btn face-a" data-id="a">A</button>
        </div>
      </div>
    </div>
  `
};

function applyControllerMode() {
  const mode = cfg.mode || 'standard';
  const controller = document.getElementById('controller');
  controller.innerHTML = CONTROLLER_TEMPLATES[mode] || CONTROLLER_TEMPLATES.standard;
  
  // Re-bind all events
  setupButtons();
  setupStick('left-stick-zone',  'left',  'left-stick-knob');
  
  // Check if right stick exists in template (Standard has it, others might not)
  if (document.getElementById('right-stick-zone')) {
    setupStick('right-stick-zone', 'right', 'right-stick-knob');
  }
  
  applyLayout();
}

function openSettings() {
  // Add a small delay for smoother transition
  setTimeout(() => {
    document.getElementById('player-name').value = cfg.name;
    document.getElementById('gyro-toggle').checked   = cfg.gyro;
    document.getElementById('haptic-toggle').checked = cfg.haptic;
    document.getElementById('layout-scale').value = cfg.scale;
    document.getElementById('stick-pos-select').value = cfg.pos;
    document.getElementById('controller-mode-select').value = cfg.mode || 'standard';
    settingsPanel.classList.remove('hidden');
  }, 200);
}

async function saveSettings(options = {}) {
  const oldGyro = cfg.gyro;
  const oldMode = cfg.mode;
  cfg.name   = document.getElementById('player-name').value.trim() || randomFunnyName();
  cfg.gyro   = document.getElementById('gyro-toggle').checked;
  cfg.haptic = document.getElementById('haptic-toggle').checked;
  cfg.scale  = parseFloat(document.getElementById('layout-scale').value);
  cfg.pos    = document.getElementById('stick-pos-select').value;
  cfg.mode   = document.getElementById('controller-mode-select').value;
  
  localStorage.setItem('tc_name',   cfg.name);
  localStorage.setItem('tc_gyro',   cfg.gyro   ? '1' : '0');
  localStorage.setItem('tc_haptic', cfg.haptic  ? '1' : '0');
  localStorage.setItem('tc_scale',  cfg.scale);
  localStorage.setItem('tc_pos',    cfg.pos);
  localStorage.setItem('tc_mode',   cfg.mode);
  
  if (cfg.name && connected) send({ type: 'name', value: cfg.name });
  
  // Handle Gyro Activation on user gesture
  if (cfg.gyro && !oldGyro) {
    await motion.requestPermission();
  } else if (!cfg.gyro && oldGyro) {
    motion.disable();
  }
  
  if (cfg.mode !== oldMode) {
    applyControllerMode();
  } else {
    applyLayout();
  }
  
  if (!options.keepOpen) settingsPanel.classList.add('hidden');
}

document.getElementById('settings-close').addEventListener('click', () => settingsPanel.classList.add('hidden'));
document.getElementById('settings-save').addEventListener('click', saveSettings);
document.getElementById('edit-layout-btn').addEventListener('click', startLayoutEditor);
document.getElementById('reset-layout-btn').addEventListener('click', resetControlLayout);
document.getElementById('layout-done').addEventListener('click', stopLayoutEditor);
document.getElementById('layout-reset').addEventListener('click', resetControlLayout);

document.getElementById('random-name-btn').addEventListener('click', () => {
  const newName = randomFunnyName();
  document.getElementById('player-name').value = newName;
  haptic(30);
});

document.getElementById('fullscreen-btn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// ── UI Sequence Management ───────────────────────────────────────────────────
const orientationPrompt = document.getElementById('orientation-prompt');
const phoneSplash        = document.getElementById('phone-splash');
let splashDone          = false;

function checkOrientation() {
  const isLandscape = window.innerWidth > window.innerHeight;
  
  if (!isLandscape) {
    orientationPrompt.classList.remove('hidden');
    return;
  }
  
  orientationPrompt.classList.add('hidden');
  
  // If we haven't shown the splash yet, show it now
  if (!splashDone) {
    showPhoneSplash();
  }
}

async function showPhoneSplash() {
  if (splashDone) return;
  phoneSplash.classList.remove('hidden');
  
  // Fake initialization delay — slightly longer for effect
  setTimeout(() => {
    phoneSplash.style.opacity = '0';
    setTimeout(() => {
      phoneSplash.classList.add('hidden');
      splashDone = true;
      // After splash, show consent if needed, or start connection
      if (!cfg.consent) {
        showConsent();
      } else {
        if (!cfg.name) {
          cfg.name = randomFunnyName();
          localStorage.setItem('tc_name', cfg.name);
        }
        initConnection();
        // Permission check for previously enabled gyro
        if (cfg.gyro) {
          motion.requestPermission();
        }
      }
    }, 600);
  }, 2800);
}

window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);

// ── Init ──────────────────────────────────────────────────────────────────────
setupLayoutControls();
applyControllerMode(); // This handles buttons, sticks, and applyLayout internally

// Start the sequence
checkOrientation();

// Multi-touch optimization: Remove global preventDefault, rely on touch-action: none
document.addEventListener('contextmenu', (e) => e.preventDefault());
