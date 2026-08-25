// Contour shuttle devices speak raw HID; no driver software needed.
// Report layout (5 bytes): [0] shuttle ring int8 -7..7, [1] jog dial uint8
// free-running counter, [2] unused, [3..4] button bitmask little-endian.
// ShuttleXpress buttons live at bits 4..8; ShuttlePRO v2 at bits 0..14.

let HID = null;
let loadError = null;
try {
  HID = require('node-hid');
} catch (e) {
  loadError = e.message;
}

const VENDOR_ID = 0x0b33;
const PRODUCTS = {
  0x0020: 'ShuttleXpress',
  0x0030: 'ShuttlePRO v2',
};

const state = {
  device: null,
  productId: null,
  productName: null,
  connected: false,
  lastShuttle: 0,
  lastJog: null,
  lastButtons: 0,
  pollTimer: null,
  onEvent: () => {},
  onStatus: () => {},
};

function getStatus() {
  return {
    available: !!HID,
    error: loadError,
    connected: state.connected,
    product: state.productName,
  };
}

function emitStatus() {
  state.onStatus(getStatus());
}

function bitToButton(bit) {
  // ShuttleXpress buttons 1-5 sit at bits 4-8; PRO v2 starts at bit 0.
  return state.productId === 0x0020 ? bit - 3 : bit + 1;
}

function parseReport(buf) {
  if (buf.length < 5) return;

  const shuttleVal = buf.readInt8(0);
  if (shuttleVal !== state.lastShuttle) {
    state.lastShuttle = shuttleVal;
    state.onEvent({ type: 'shuttle', value: shuttleVal });
  }

  const jog = buf[1];
  if (state.lastJog !== null && jog !== state.lastJog) {
    const delta = ((jog - state.lastJog + 128) & 0xff) - 128;
    if (delta) state.onEvent({ type: 'jog', delta });
  }
  state.lastJog = jog;

  const buttons = buf[3] | (buf[4] << 8);
  const changed = buttons ^ state.lastButtons;
  if (changed) {
    for (let bit = 0; bit < 16; bit++) {
      const mask = 1 << bit;
      if (changed & mask) {
        state.onEvent({
          type: 'button',
          button: bitToButton(bit),
          down: !!(buttons & mask),
        });
      }
    }
    state.lastButtons = buttons;
  }
}

function closeDevice() {
  if (state.device) {
    try {
      state.device.close();
    } catch {
      // already gone
    }
  }
  state.device = null;
  state.productId = null;
  state.productName = null;
  if (state.connected) {
    state.connected = false;
    emitStatus();
  }
}

function tryOpen() {
  if (!HID || state.device) return;
  let info = null;
  try {
    info = HID.devices().find((d) => d.vendorId === VENDOR_ID && PRODUCTS[d.productId]);
  } catch {
    return;
  }
  if (!info) return;
  try {
    const device = new HID.HID(info.path);
    state.device = device;
    state.productId = info.productId;
    state.productName = PRODUCTS[info.productId];
    state.lastShuttle = 0;
    state.lastJog = null;
    state.lastButtons = 0;
    device.on('data', (buf) => {
      try {
        parseReport(buf);
      } catch (err) {
        console.error('[shuttle] parse error:', err);
      }
    });
    device.on('error', () => closeDevice());
    state.connected = true;
    emitStatus();
  } catch (err) {
    console.error('[shuttle] open failed:', err.message);
    closeDevice();
  }
}

function start({ onEvent, onStatus }) {
  state.onEvent = onEvent || state.onEvent;
  state.onStatus = onStatus || state.onStatus;
  if (loadError) {
    console.error('[shuttle] node-hid unavailable:', loadError);
    return;
  }
  tryOpen();
  state.pollTimer = setInterval(tryOpen, 3000);
}

function stop() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  closeDevice();
}

module.exports = { start, stop, getStatus };
