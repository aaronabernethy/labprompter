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

function start({ onEvent, deviceId } = {}) {
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
    const env = { ...process.env };
    if (deviceId) env.LABPROMPTER_INPUT_DEVICE_UID = deviceId;
    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], env });
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

// Enumerates microphones without touching speech/mic permission (see
// main.swift's `list-devices` mode) — a short-lived, separate process from
// the one that actually listens, so populating a Settings dropdown never
// triggers a permission prompt on its own.
function listInputs() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ ok: false, error: 'Voice-follow needs macOS.' });
      return;
    }
    const bin = helperPath();
    if (!fs.existsSync(bin)) {
      resolve({ ok: false, error: 'The voice-follow helper isn’t bundled with this build yet.' });
      return;
    }

    let proc;
    try {
      proc = spawn(bin, ['list-devices'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: 'Could not list microphones: ' + err.message });
      return;
    }

    let out = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
      finish({ ok: false, error: 'Timed out listing microphones.' });
    }, 5000);

    proc.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
    });
    proc.on('error', (err) => finish({ ok: false, error: 'Could not list microphones: ' + err.message }));
    proc.on('exit', () => {
      const line = out.split('\n').find((l) => l.trim());
      try {
        const ev = line ? JSON.parse(line) : null;
        if (ev && ev.type === 'devices' && Array.isArray(ev.devices)) {
          finish({ ok: true, devices: ev.devices });
          return;
        }
        if (ev && ev.type === 'error' && ev.message) {
          finish({ ok: false, error: ev.message });
          return;
        }
      } catch {
        // fall through to the generic error below
      }
      finish({ ok: false, error: 'Could not list microphones.' });
    });
  });
}

function status() {
  return { available: available(), running: !!state.proc };
}

module.exports = { start, stop, status, available, listInputs };
