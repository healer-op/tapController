const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { handleInput } = require('./input');

// ── Input validation ──────────────────────────────────────────────────────────
const VALID_TYPES   = new Set(['button','axis','trigger','gyro','name','mouse-click','ping']);
const VALID_BTN_IDS = new Set(['a','b','x','y','lb','rb','start','back','guide',
  'thumb_left','thumb_right','dpad_up','dpad_down','dpad_left','dpad_right','lt','rt']);
const VALID_MODES   = new Set(['gamepad','keyboard','mouse']);
const VALID_AXIS    = new Set(['left','right']);
const VALID_TRIG    = new Set(['left','right','lt','rt']);
const VALID_MB      = new Set(['left','right','middle']);
const MAX_PLAYERS   = 4;

function validateMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  if (!VALID_TYPES.has(msg.type)) return false;
  if (msg.mode !== undefined && !VALID_MODES.has(msg.mode)) return false;

  switch (msg.type) {
    case 'button':
      return VALID_BTN_IDS.has(msg.id) && typeof msg.pressed === 'boolean';
    case 'axis':
      return VALID_AXIS.has(msg.id)
        && typeof msg.x === 'number' && isFinite(msg.x)
        && typeof msg.y === 'number' && isFinite(msg.y);
    case 'trigger':
      return VALID_TRIG.has(msg.id)
        && typeof msg.value === 'number' && isFinite(msg.value);
    case 'gyro':
      return typeof msg.alpha === 'number' && isFinite(msg.alpha)
        && typeof msg.beta  === 'number' && isFinite(msg.beta)
        && typeof msg.gamma === 'number' && isFinite(msg.gamma);
    case 'name':
      return typeof msg.value === 'string' && msg.value.length <= 32;
    case 'mouse-click':
      return VALID_MB.has(msg.button ?? 'left');
    case 'ping':
      return true;
    default:
      return false;
  }
}

const FUNNY_ANIMALS = [
  ['🐔', 'Lazy Chicken'],    ['🦒', 'Giant Giraffe'],   ['🐼', 'Sleepy Panda'],
  ['🦭', 'Dramatic Seal'],   ['🦛', 'Chonky Hippo'],    ['🐧', 'Confused Penguin'],
  ['🦆', 'Angry Duck'],      ['🐨', 'Derpy Koala'],     ['🦦', 'Sneaky Otter'],
  ['🐸', 'Tiny Frog'],       ['🦔', 'Spiky Hedgehog'],  ['🐢', 'Speedy Turtle'],
  ['🦩', 'Extra Flamingo'],  ['🐻', 'Dramatic Bear'],   ['🐡', 'Round Fish'],
  ['🦜', 'Loud Parrot'],     ['🐙', 'Wobbly Octopus'],  ['🦊', 'Sneaky Fox'],
  ['🐯', 'Grumpy Tiger'],    ['🦁', 'Sleepy Lion'],     ['🦝', 'Trash Panda'],
  ['🐸', 'Jumping Frog'],    ['🦌', 'Fancy Deer'],      ['🐺', 'Howling Wolf'],
];

function randomFunnyName() {
  const [emoji, name] = FUNNY_ANIMALS[Math.floor(Math.random() * FUNNY_ANIMALS.length)];
  return `${emoji} ${name}`;
}

const clients = new Map();
const playerSlots = Array(MAX_PLAYERS).fill(null);
let globalEmit = null;
let activeWss = null;
let activeHttpServer = null;
let heartbeatInterval = null;

function allocateSlot(id) {
  // Ensure the ID is not already in a slot (Multiple Connection Bug fix)
  const existingSlot = playerSlots.indexOf(id);
  if (existingSlot !== -1) return existingSlot;

  const slot = playerSlots.findIndex((existing) => existing === null);
  if (slot === -1) return -1;
  playerSlots[slot] = id;
  return slot;
}

function releaseSlot(id) {
  let releasedCount = 0;
  for (let i = 0; i < playerSlots.length; i++) {
    if (playerSlots[i] === id) {
      playerSlots[i] = null;
      releasedCount++;
    }
  }
  return releasedCount;
}

function getSlot(id) {
  return playerSlots.findIndex((existing) => existing === id);
}

function getControllerId(id) {
  const slot = getSlot(id);
  return slot === -1 ? null : `P${slot + 1}`;
}

function normalizeInput(msg) {
  if (msg.type !== 'trigger') return msg;
  if (msg.id === 'lt') return { ...msg, id: 'left' };
  if (msg.id === 'rt') return { ...msg, id: 'right' };
  return msg;
}

function setAdmin(id) {
  const currentSlot = getSlot(id);
  if (currentSlot <= 0) return;

  const oldP1 = playerSlots[0];
  playerSlots[0] = id;
  playerSlots[currentSlot] = oldP1;

  playerSlots.forEach((clientId, index) => {
    if (!clientId) return;
    const client = clients.get(clientId);
    if (client) {
      client.slot = index + 1;
      client.controllerId = `P${index + 1}`;
    }
  });

  if (globalEmit) {
    globalEmit('client-event', {
      type: 'slots-changed',
      slots: playerSlots.map((clientId, index) => ({ clientId, slot: index + 1 })),
    });
    globalEmit('client-event', { type: 'admin-changed', adminId: playerSlots[0] });
  }
}

function createServer(port, token, emit) {
  globalEmit = emit;
  const app = express();
  const httpServer = http.createServer(app);

  // Only serve the phone controller UI — no directory listing
  app.use('/controller', express.static(path.join(__dirname, '../phone'), {
    dotfiles: 'deny',
    index: 'index.html',
  }));

  // Serve assets
  app.use('/assets', express.static(path.join(__dirname, '../assets')));

  // Health check (no auth needed)
  app.get('/ping', (_req, res) => res.json({ ok: true }));

  // Block everything else
  app.use((_req, res) => res.status(404).end());

  // ── WebSocket server ─────────────────────────────────────────────────────
  activeHttpServer = httpServer;
  const wss = new WebSocketServer({
    server: httpServer,
    // Validate token on upgrade — reject unauthorized connections
    verifyClient: ({ req }, cb) => {
      try {
        // More robust URL parsing for proxies
        const fullUrl = req.url.startsWith('http') ? req.url : `http://${req.headers.host || 'localhost'}${req.url}`;
        const url = new URL(fullUrl);
        const t   = url.searchParams.get('token');
        
        if (t === token) return cb(true);
        
        console.warn(`[server] Unauthorized connection attempt from ${req.socket.remoteAddress} (Token: ${t})`);
        cb(false, 401, 'Unauthorized');
      } catch (err) {
        console.error('[server] verifyClient error:', err);
        cb(false, 400, 'Bad Request');
      }
    },
  });
  activeWss = wss;

  heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.warn(`[server] Connection appears stale for client (no pong)`);
        // return ws.terminate(); // Disabled to debug 1006
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
    });
  }, 30000);

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://localhost`);
    const requestedId = url.searchParams.get('clientId');
    
    let id, name, slot, isResumed = false;
    const existing = requestedId ? clients.get(requestedId) : null;

    if (existing) {
      // Resume existing session
      id = requestedId;
      name = existing.name;
      slot = existing.slot - 1;
      isResumed = true;
      
      // Terminate old socket only if it's actually closed or we're sure it's dead
      // (Disabled immediate terminate to prevent 'fighting' connections loop)
      /*
      if (existing.ws && existing.ws !== ws) {
        try { existing.ws.terminate(); } catch (_) {}
      }
      */
      
      existing.ws = ws;
      console.log(`[server] Resumed session for ${name} (${id})`);
    } else {
      id   = (requestedId && requestedId !== 'null' && requestedId !== 'undefined') ? requestedId : uuidv4();
      name = randomFunnyName();
      slot = allocateSlot(id);

      if (slot === -1) {
        ws.close(1013, 'Controller slots full');
        return;
      }
      console.log(`[server] New session for ${name} (${id})`);
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const controllerId = `P${slot + 1}`;
    if (!isResumed) {
      clients.set(id, { id, ws, name, slot: slot + 1, controllerId });
    }

    // ... (rest of the setup)
    if (!isResumed) {
      emit('client-event', { type: 'connected', id, name, slot: slot + 1, controllerId });
      if (slot === 0) emit('client-event', { type: 'admin-changed', adminId: id });
      
      // Initialize controller on Python side
      handleInput(controllerId, { type: 'connect' });
    } else {
      // If resumed, maybe emit a 'resumed' event or just 'connected' to refresh UI
      emit('client-event', { type: 'connected', id, name, slot: slot + 1, controllerId });
    }
    
    ws.send(JSON.stringify({ type: 'welcome', id, name, slot: slot + 1, controllerId }));
    
    // Per-client rate limiter: max 120 msgs/sec
    let msgCount  = 0;
    let rlResetAt = Date.now() + 1000;

    ws.on('message', (raw) => {
      // Rate limiting
      const now = Date.now();
      if (now > rlResetAt) { msgCount = 0; rlResetAt = now + 1000; }
      if (++msgCount > 200) return; // silently drop

      // Size limit (8 KB max)
      if (raw.length > 8192) return;

      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (!validateMessage(msg)) return; // drop invalid

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (msg.type === 'name') {
        const c = clients.get(id);
        if (c) {
          c.name = msg.value.slice(0, 24);
          emit('client-event', { type: 'renamed', id, name: c.name });
        }
        return;
      }

      const normalized = normalizeInput(msg);
      const currentControllerId = getControllerId(id);
      if (!currentControllerId) return;

      handleInput(currentControllerId, normalized);
      emit('client-event', { type: 'input', id, data: normalized });
    });

    ws.on('close', (code, reason) => {
      const c = clients.get(id);
      if (c && c.ws !== ws) return; // Don't clean up if this is an old session being replaced

      console.log(`[server] Session closed for ${c?.name || 'unknown'} (${id}) | Code: ${code} | Reason: ${reason}`);

      const controllerId = getControllerId(id) || c?.controllerId;
      clients.delete(id);
      releaseSlot(id);
      if (c) {
        handleInput(controllerId, { type: 'disconnect' });
        emit('client-event', { type: 'disconnected', id, name: c.name, slot: c.slot, controllerId });
      }
      emit('client-event', { type: 'admin-changed', adminId: playerSlots[0] });
    });

    ws.on('error', () => {
      const c = clients.get(id);
      if (c && c.ws !== ws) return; // Don't clean up if this is an old session being replaced

      const controllerId = getControllerId(id) || c?.controllerId;
      clients.delete(id);
      releaseSlot(id);
      if (c) handleInput(controllerId, { type: 'disconnect' });
    });
  });

  httpServer.on('error', (err) => {
    console.error('[server] HTTP server error:', err);
    if (globalEmit) globalEmit('status', { type: 'server-error', message: err.message });
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[server] HTTP server listening on 0.0.0.0:${port}`);
  });

  return httpServer;
}

function closeServer() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  // Terminate every active WebSocket client so the HTTP server can close cleanly
  if (clients) {
    for (const client of clients.values()) {
      try { 
        if (client.ws) client.ws.terminate(); 
      } catch (_) {}
    }
    clients.clear();
  }

  if (activeWss) {
    try { activeWss.close(); } catch (_) {}
    activeWss = null;
  }

  if (activeHttpServer) {
    try { activeHttpServer.close(); } catch (_) {}
    activeHttpServer = null;
  }
}

module.exports = {
  createServer,
  closeServer,
  clients,
  setAdmin,
  getAdmin: () => playerSlots[0],
  getSlots: () => playerSlots.map((clientId, index) => ({ clientId, slot: index + 1 })),
};
