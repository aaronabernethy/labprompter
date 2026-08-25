// LabPrompter Stream Deck plugin. Talks to the Stream Deck app over its
// WebSocket, and to LabPrompter over its local control API.
/* global WebSocket */

const LAB = 'http://127.0.0.1:43717';

const LABELS = {
  scrollDown: 'Scroll ↓',
  scrollUp: 'Scroll ↑',
  jumpTop: 'Top',
  prevMarker: 'Prev\nSection',
  nextMarker: 'Next\nSection',
  fontUp: 'Text\nBigger',
  fontDown: 'Text\nSmaller',
  play: 'Play',
  pause: 'Pause',
  playPause: '',
  speedUp: 'Speed +',
  speedDown: 'Speed −',
  toggleCaps: 'CAPS',
  toggleReverse: 'Reverse',
  eyeLineUp: 'Eye ↑',
  eyeLineDown: 'Eye ↓',
  togglePresent: 'Present',
  exitPresent: 'Exit',
};

// Hold-to-scroll commands send a stop when the key is released.
const HOLD = new Set(['scrollDown', 'scrollUp']);

let ws = null;
const contexts = {};
let playing = false;

function cmdOf(context) {
  return (contexts[context] && contexts[context].command) || 'playPause';
}

function sdSend(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function refreshTitle(context) {
  const cmd = cmdOf(context);
  const title = cmd === 'playPause' ? (playing ? '❚❚' : '▶') : LABELS[cmd] || cmd;
  sdSend({ event: 'setTitle', context, payload: { title, target: 0 } });
}

function labSend(command, context) {
  fetch(LAB + '/command', { method: 'POST', body: command })
    .then((r) => {
      if (!r.ok) sdSend({ event: 'showAlert', context });
    })
    .catch(() => sdSend({ event: 'showAlert', context }));
}

function poll() {
  fetch(LAB + '/state')
    .then((r) => r.json())
    .then((s) => {
      if (s.playing !== playing) {
        playing = s.playing;
        for (const c of Object.keys(contexts)) {
          if (cmdOf(c) === 'playPause') refreshTitle(c);
        }
      }
    })
    .catch(() => {});
}

// Called by the Stream Deck app once the plugin page loads.
function connectElgatoStreamDeckSocket(port, pluginUUID, registerEvent) {
  ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.onopen = () => ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const context = m.context;
    switch (m.event) {
      case 'willAppear':
        contexts[context] = (m.payload && m.payload.settings) || {};
        refreshTitle(context);
        break;
      case 'willDisappear':
        delete contexts[context];
        break;
      case 'didReceiveSettings':
        contexts[context] = (m.payload && m.payload.settings) || {};
        refreshTitle(context);
        break;
      case 'keyDown':
        labSend(cmdOf(context), context);
        break;
      case 'keyUp':
        if (HOLD.has(cmdOf(context))) labSend('scrollStop', context);
        break;
    }
  };
  setInterval(poll, 1000);
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
