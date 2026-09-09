// StudioOS (The Content Lab) connection.
//
// LabPrompter pairs with StudioOS once, by typing a short code from
// Admin → Studio Devices. The code is exchanged for a long-lived device
// token which lives in userData/studio.json — main-process only; the
// renderer sees connection status and session data, never the token.
// From then on the Library's Sessions tab pulls upcoming sessions and
// their scripts (already teleprompter-ready plain text) from the server.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_BASE_URL = 'https://thecontentlab.co.uk';
const TIMEOUT_MS = 15000;

function filePath() {
  return path.join(app.getPath('userData'), 'studio.json');
}

function readConn() {
  try {
    const c = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    return c && typeof c.token === 'string' && c.token ? c : null;
  } catch {
    return null;
  }
}

function writeConn(conn) {
  fs.writeFileSync(filePath(), JSON.stringify(conn, null, 2), { mode: 0o600 });
}

function normaliseBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s); // throws on garbage
  return u.origin;
}

// Public view of the connection — what Settings and the Sessions tab show.
function status() {
  const c = readConn();
  if (!c) return { connected: false, baseUrl: DEFAULT_BASE_URL };
  return {
    connected: true,
    deviceName: c.deviceName || 'LabPrompter',
    baseUrl: c.baseUrl,
    pairedAt: c.pairedAt || null,
    revoked: Boolean(c.revokedAt),
  };
}

async function request(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

function describeNetworkError(err) {
  if (err && err.name === 'AbortError') return 'StudioOS did not respond in time.';
  return 'Could not reach StudioOS — check the internet connection.';
}

async function pair(code, baseUrlInput) {
  const cleaned = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 8) {
    return { ok: false, error: 'Enter the 8-character code shown in StudioOS, e.g. ABCD-EFGH.' };
  }
  let baseUrl;
  try {
    baseUrl = normaliseBaseUrl(baseUrlInput);
  } catch {
    return { ok: false, error: 'That StudioOS address is not a valid URL.' };
  }

  let out;
  try {
    out = await request(`${baseUrl}/api/studio/prompter/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: cleaned }),
    });
  } catch (err) {
    return { ok: false, error: describeNetworkError(err) };
  }

  const { res, data } = out;
  if (!res.ok || !data || typeof data.token !== 'string') {
    return {
      ok: false,
      error: (data && data.error) || `StudioOS refused the code (HTTP ${res.status}).`,
    };
  }

  let finalBase = baseUrl;
  try {
    if (data.siteUrl) finalBase = normaliseBaseUrl(data.siteUrl);
  } catch {
    // keep what the user typed
  }
  writeConn({
    baseUrl: finalBase,
    token: data.token,
    deviceName: (data.device && data.device.name) || 'LabPrompter',
    pairedAt: Date.now(),
  });
  return { ok: true, status: status() };
}

function disconnect() {
  try {
    fs.unlinkSync(filePath());
  } catch {
    // already gone
  }
  return status();
}

async function fetchSessions() {
  const c = readConn();
  if (!c) return { ok: false, code: 'not_connected', error: 'Not connected to StudioOS.' };

  let out;
  try {
    out = await request(`${c.baseUrl}/api/studio/prompter/sessions`, {
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' },
    });
  } catch (err) {
    return { ok: false, code: 'network', error: describeNetworkError(err) };
  }

  const { res, data } = out;
  if (res.status === 403 && data && data.code === 'revoked') {
    writeConn({ ...c, revokedAt: Date.now() });
    return {
      ok: false,
      code: 'revoked',
      error: 'This device has been deregistered in StudioOS. Pair again with a fresh code.',
    };
  }
  if (res.status === 401) {
    return { ok: false, code: 'unauthorised', error: 'StudioOS no longer recognises this device. Pair again with a fresh code.' };
  }
  if (!res.ok || !data || !Array.isArray(data.sessions)) {
    return { ok: false, code: 'server', error: (data && data.error) || `StudioOS error (HTTP ${res.status}).` };
  }

  if (c.revokedAt) writeConn({ ...c, revokedAt: undefined });
  return { ok: true, sessions: data.sessions, deviceName: data.device && data.device.name, fetchedAt: Date.now() };
}

module.exports = { status, pair, disconnect, fetchSessions, DEFAULT_BASE_URL };
