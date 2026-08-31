// Local control API for external surfaces (Stream Deck plugin, curl, etc).
// Bound to 127.0.0.1 only. POST /command with a plain-text action name;
// GET /state returns { presenting, playing }.

const http = require('http');

const PORT = 43717;

const COMMANDS = new Set([
  'play',
  'pause',
  'playPause',
  'scrollDown',
  'scrollUp',
  'scrollStop',
  'jumpTop',
  'jumpEnd',
  'nudgeDown',
  'nudgeUp',
  'prevMarker',
  'nextMarker',
  'toggleReverse',
  'speedUp',
  'speedDown',
  'fontUp',
  'fontDown',
  'toggleCaps',
  'eyeLineUp',
  'eyeLineDown',
  'togglePresent',
  'enterPresent',
  'exitPresent',
]);

let server = null;
let state = { presenting: false, playing: false };

function start({ onCommand }) {
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.method === 'POST' && req.url === '/command') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 256) req.destroy();
      });
      req.on('end', () => {
        const action = body.trim();
        if (COMMANDS.has(action)) {
          onCommand(action);
          res.writeHead(204);
        } else {
          res.writeHead(400);
        }
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('error', (err) => {
    console.error(`[control] server unavailable on port ${PORT}:`, err.message);
    server = null;
  });
  server.listen(PORT, '127.0.0.1');
}

function setState(patch) {
  state = { ...state, ...patch };
}

function getState() {
  return state;
}

function stop() {
  if (server) server.close();
  server = null;
}

module.exports = { start, stop, setState, getState, PORT };
