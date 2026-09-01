// Network remote control: any LabPrompter instance can act as the studio
// (server) side, the remote (client) side, or both. Transport is
// newline-delimited JSON over TCP; discovery is Bonjour/mDNS.
//
// Client -> server: hello, ping, cmd {action}, shuttle {v}, jog {d},
//                   button {b, down}, edit {body}
// Server -> client: welcome, pong, doc {title, body, s, vw, vh},
//                   state {presenting, playing, pos, max, speed, baseSpeedPct}
//
// Safety: a client whose socket drops (or stalls >2s) while its shuttle is
// deflected has the shuttle zeroed so the prompter never runs away.

const net = require('net');
const os = require('os');
const crypto = require('crypto');

let Bonjour = null;
try {
  ({ Bonjour } = require('bonjour-service'));
} catch (err) {
  console.error('[remote] bonjour-service unavailable:', err.message);
}

const REMOTE_PORT = 43718;
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');

function hostname() {
  return os.hostname().replace(/\.local\.?$/i, '');
}

function attachJsonLines(socket, onMsg) {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > 1e6) {
      socket.destroy();
      return;
    }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        onMsg(JSON.parse(line));
      } catch {
        // ignore malformed lines
      }
    }
  });
}

function sendMsg(socket, obj) {
  try {
    socket.write(JSON.stringify(obj) + '\n');
  } catch {
    // socket already gone
  }
}

// ---------- server (being controlled) ----------

const server = {
  srv: null,
  clients: new Set(),
  bonjour: null,
  service: null,
  deadman: null,
  cb: null,
};

function startServer(cb) {
  if (server.srv || !cb) return;
  server.cb = cb;
  const srv = net.createServer((socket) => {
    socket.setNoDelay(true);
    const client = { socket, alive: Date.now(), shuttleActive: false };
    server.clients.add(client);
    attachJsonLines(socket, (m) => {
      client.alive = Date.now();
      switch (m.t) {
        case 'hello':
          sendMsg(socket, { t: 'welcome', name: hostname(), id: INSTANCE_ID });
          if (server.cb.getDoc()) sendMsg(socket, { t: 'doc', ...server.cb.getDoc() });
          sendMsg(socket, { t: 'state', ...server.cb.getState() });
          break;
        case 'ping':
          sendMsg(socket, { t: 'pong' });
          break;
        case 'cmd':
          if (typeof m.action === 'string') server.cb.onCommand(m.action);
          break;
        case 'shuttle':
          if (Number.isFinite(m.v)) {
            const v = Math.max(-7, Math.min(7, m.v | 0));
            client.shuttleActive = v !== 0;
            server.cb.onInput({ type: 'shuttle', value: v });
          }
          break;
        case 'jog':
          if (Number.isFinite(m.d)) {
            server.cb.onInput({ type: 'jog', delta: Math.max(-32, Math.min(32, m.d | 0)) });
          }
          break;
        case 'button':
          if (Number.isFinite(m.b)) {
            server.cb.onInput({ type: 'button', button: m.b | 0, down: m.down !== false });
          }
          break;
        case 'edit':
          if (server.cb.onEdit && typeof m.body === 'string' && m.body.length <= 2e5) {
            server.cb.onEdit(m.body);
          }
          break;
      }
    });
    const drop = () => {
      if (!server.clients.has(client)) return;
      server.clients.delete(client);
      if (client.shuttleActive) server.cb.onInput({ type: 'shuttle', value: 0 });
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });
  srv.on('error', (err) => {
    console.error('[remote] server unavailable:', err.message);
    server.srv = null;
  });
  srv.listen(REMOTE_PORT, '0.0.0.0', () => advertise());
  server.srv = srv;

  server.deadman = setInterval(() => {
    const now = Date.now();
    for (const c of server.clients) {
      if (c.shuttleActive && now - c.alive > 2000) {
        c.shuttleActive = false;
        server.cb.onInput({ type: 'shuttle', value: 0 });
      }
      if (now - c.alive > 10000) c.socket.destroy();
    }
  }, 1000);
}

function advertise() {
  if (!Bonjour || server.service) return;
  server.bonjour = server.bonjour || new Bonjour();
  server.service = server.bonjour.publish({
    name: `LabPrompter on ${hostname()}`,
    type: 'labprompter',
    port: REMOTE_PORT,
    txt: { id: INSTANCE_ID },
  });
}

function broadcast(obj) {
  for (const c of server.clients) sendMsg(c.socket, obj);
}

function stopServer() {
  clearInterval(server.deadman);
  server.deadman = null;
  for (const c of server.clients) c.socket.destroy();
  server.clients.clear();
  if (server.srv) server.srv.close();
  server.srv = null;
  if (server.bonjour) server.bonjour.unpublishAll();
  server.service = null;
}

// ---------- discovery (finding instances to control) ----------

const disco = { bonjour: null, browser: null, services: new Map() };

function startDiscovery(onChange) {
  if (!Bonjour) {
    onChange([]);
    return;
  }
  disco.bonjour = disco.bonjour || new Bonjour();
  disco.browser = disco.bonjour.find({ type: 'labprompter' });
  const emit = () => onChange(listDiscovered());
  disco.browser.on('up', (s) => {
    if (s.txt && s.txt.id === INSTANCE_ID) return;
    const ipv4 = (s.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    disco.services.set(s.fqdn || s.name, {
      name: s.name,
      host: ipv4 || s.host,
      port: s.port || REMOTE_PORT,
    });
    emit();
  });
  disco.browser.on('down', (s) => {
    disco.services.delete(s.fqdn || s.name);
    emit();
  });
}

function listDiscovered() {
  return [...disco.services.values()];
}

// ---------- client (controlling another instance) ----------

const client = { socket: null, connected: false, pingTimer: null };

function connect(host, port, cb) {
  disconnect();
  const socket = net.connect({ host, port: port || REMOTE_PORT });
  socket.setNoDelay(true);
  client.socket = socket;
  let failed = false;
  const fail = (msg) => {
    if (failed || client.socket !== socket) return;
    failed = true;
    disconnect();
    cb.onStatus({ connected: false, error: msg });
  };
  socket.on('connect', () => sendMsg(socket, { t: 'hello', name: hostname() }));
  attachJsonLines(socket, (m) => {
    switch (m.t) {
      case 'welcome':
        client.connected = true;
        cb.onStatus({ connected: true, name: m.name, host });
        break;
      case 'doc':
        cb.onDoc(m);
        break;
      case 'state':
        cb.onState(m);
        break;
    }
  });
  socket.on('error', (err) => fail(err.message));
  socket.on('close', () => fail(client.connected ? 'connection lost' : 'could not connect'));
  socket.setTimeout(5000, () => {
    if (!client.connected) fail('connection timed out');
  });
  client.pingTimer = setInterval(() => {
    if (client.socket) sendMsg(client.socket, { t: 'ping' });
  }, 1000);
}

function clientSend(obj) {
  if (client.socket && client.connected) sendMsg(client.socket, obj);
}

function disconnect() {
  clearInterval(client.pingTimer);
  client.pingTimer = null;
  if (client.socket) {
    client.socket.removeAllListeners('close');
    client.socket.removeAllListeners('error');
    client.socket.destroy();
  }
  client.socket = null;
  client.connected = false;
}

function stopAll() {
  stopServer();
  disconnect();
  if (disco.bonjour) disco.bonjour.destroy();
  disco.bonjour = null;
}

module.exports = {
  startServer,
  stopServer,
  broadcast,
  startDiscovery,
  listDiscovered,
  connect,
  clientSend,
  disconnect,
  stopAll,
  REMOTE_PORT,
};
