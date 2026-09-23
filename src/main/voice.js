// Bridges to the native speech-helper binary (native/speech-helper/) for
// voice-follow: Node/Electron can't call Apple's Speech framework directly,
// so a small Swift CLI does the listening and reports transcribed text back
// over stdout as line-delimited JSON. See docs/voice-follow.md.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const BIN_NAME = 'speech-helper';

function helperPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, BIN_NAME);
  // `npm run build:helper` stages the same path a packaged build bundles,
  // whether that's a real compiled binary (macOS + Swift) or the graceful
  // stub (see tools/build-speech-helper.js).
  return path.join(__dirname, '..', '..', 'native', 'speech-helper', 'dist', BIN_NAME);
}

const state = {
  proc: null,
  onEvent: () => {},
};

function available() {
  return process.platform === 'darwin' && fs.existsSync(helperPath());
}

function start({ onEvent } = {}) {
  if (state.proc) return { ok: true };
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Voice-follow needs macOS — it runs on Apple’s on-device Speech framework.' };
  }
  const bin = helperPath();
  if (!fs.existsSync(bin)) {
    return { ok: false, error: 'The voice-follow helper isn’t bundled with this build yet.' };
  }

  state.onEvent = onEvent || state.onEvent;

  let proc;
  try {
    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return { ok: false, error: 'Could not start the voice-follow helper: ' + err.message };
  }

  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) {
        try {
          state.onEvent(JSON.parse(line));
        } catch {
          // ignore a malformed line rather than take down the bridge
        }
      }
    }
  });
  proc.stderr.on('data', (chunk) => {
    console.error('[voice] helper stderr:', chunk.toString('utf8').trim());
  });
  proc.on('exit', (code) => {
    if (state.proc === proc) state.proc = null;
    state.onEvent({ type: 'stopped', code });
  });
  proc.on('error', (err) => {
    if (state.proc === proc) state.proc = null;
    state.onEvent({ type: 'error', message: 'Voice-follow helper crashed: ' + err.message });
  });

  state.proc = proc;
  return { ok: true };
}

function stop() {
  if (!state.proc) return;
  const proc = state.proc;
  try {
    proc.stdin.write('stop\n');
  } catch {
    // pipe already gone; fall through to the kill timer below
  }
  setTimeout(() => {
    if (state.proc === proc) {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    }
  }, 1500);
}

function status() {
  return { available: available(), running: !!state.proc };
}

module.exports = { start, stop, status, available };
