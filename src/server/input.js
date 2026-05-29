const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let helperProc = null;
let helperReady = false;
let helperViGEm = false;

const pendingQueue = [];

// ── Resolve helper executable ──────────────────────────────────────────────────
function getHelperCommand() {
  const { app } = require('electron');
  const fs = require('fs');
  const isPackaged = app ? app.isPackaged : false;
  
  // Resolve paths
  const toolsDir = isPackaged 
    ? path.join(process.resourcesPath, 'tools')
    : path.join(__dirname, '../../tools');
    
  const exePath = path.join(toolsDir, 'gamepad_helper.exe');
  const pyPath = path.join(toolsDir, 'gamepad_helper.py');
  
  // If the standalone executable exists (or we are on Windows and packaged), use it
  if (fs.existsSync(exePath)) {
    return { cmd: exePath, args: [] };
  }
  
  // Fallback to python
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';
  return { cmd: pyBin, args: [pyPath] };
}

// ── Spawn helper ─────────────────────────────────────────────────────────────
function spawnHelper() {
  if (helperProc) return;

  const { cmd, args } = getHelperCommand();

  try {
    helperProc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    helperProc.on('error', (err) => {
      console.error('[input] Failed to start Python helper:', err);
      fs.appendFileSync(logFile, `SPAWN ERROR: ${err.message}\n`);
      helperProc = null;
      helperReady = false;
    });
  } catch (e) {
    console.error('[input] Exception while spawning Python helper:', e.message);
    fs.appendFileSync(logFile, `SPAWN EXCEPTION: ${e.message}\n`);
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
      console.log('[input] Stopping helper process...');
      helperProc.stdin.end();
      // On Windows, SIGTERM is often enough, but let's be sure.
      helperProc.kill('SIGTERM');
      
      const procToKill = helperProc;
      setTimeout(() => {
        if (procToKill && !procToKill.killed) {
          try { procToKill.kill('SIGKILL'); } catch (_) {}
        }
      }, 1000).unref();
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
