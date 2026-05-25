const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let helperProc = null;
let helperReady = false;
let helperViGEm = false;

const pendingQueue = [];

// ── Resolve python executable ────────────────────────────────────────────────
function getPythonBin() {
  // Prefer pythonw (no console window) on Windows
  if (process.platform === 'win32') return 'python';
  return 'python3';
}

function getHelperPath() {
  const { app } = require('electron');
  const isPackaged = app ? app.isPackaged : false;
  
  if (isPackaged) {
    // In packaged app, tools are in the resources/tools directory
    return path.join(process.resourcesPath, 'tools/gamepad_helper.py');
  }
  // In dev environment
  return path.join(__dirname, '../../tools/gamepad_helper.py');
}

// ── Spawn helper ─────────────────────────────────────────────────────────────
function spawnHelper() {
  if (helperProc) return;

  const py   = getPythonBin();
  const script = getHelperPath();

  try {
    helperProc = spawn(py, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error('[input] Failed to spawn Python helper:', e.message);
    return;
  }

  const rl = readline.createInterface({ input: helperProc.stdout });

  const { app } = require('electron');
  const fs = require('fs');
  const logFile = path.join(app.getPath('userData'), 'python-helper.log');
  fs.writeFileSync(logFile, `Helper spawning. isPackaged=${app.isPackaged}\n`);

  rl.on('line', (line) => {
    fs.appendFileSync(logFile, `STDOUT: ${line}\n`);
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'ready') {
        helperReady  = true;
        helperViGEm  = !!msg.vigem;
        console.log(`[input] Python helper ready | ViGEm=${helperViGEm}`);
        if (!helperViGEm) {
          fs.appendFileSync(logFile, `ViGEm Error: ${msg.vigem_error || 'Unknown'}\n`);
          console.warn('[input] ViGEm not available. Install ViGEm Bus Driver:');
          console.warn('[input] https://github.com/nefarius/ViGEmBus/releases');
        }
        
        // Flush queued messages
        pendingQueue.splice(0).forEach(send);
      } else if (msg.type === 'error') {
        fs.appendFileSync(logFile, `ERROR: ${msg.message}\n`);
        console.error('[input] Helper error:', msg.message);
      }
    } catch (_) {}
  });

  helperProc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) {
      fs.appendFileSync(logFile, `STDERR: ${text}\n`);
      console.warn('[input:py]', text);
    }
  });

  helperProc.on('exit', (code) => {
    console.log(`[input] Python helper exited (code ${code})`);
    helperProc  = null;
    helperReady = false;
  });
}

function send(obj) {
  if (!helperProc) return;
  if (!helperReady) {
    pendingQueue.push(obj);
    return;
  }
  try {
    helperProc.stdin.write(JSON.stringify(obj) + '\n');
  } catch (_) {}
}

// ── Public API ────────────────────────────────────────────────────────────────
function handleInput(clientId, msg) {
  if (msg.type === 'disconnect') {
    send({ type: 'disconnect', client_id: clientId });
    return;
  }

  // Forward message to Python helper with client_id attached
  send({ ...msg, client_id: clientId });
}

function stopHelper() {
  if (helperProc) {
    try {
      helperProc.stdin.end();
      helperProc.kill('SIGTERM');
    } catch (e) {
      console.error('[input] Error killing helper:', e);
    }
    helperProc = null;
    helperReady = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
spawnHelper();

process.on('exit', stopHelper);

module.exports = { 
  handleInput, 
  stopHelper,
  getStatus: () => ({ helperViGEm, helperReady }) 
};
