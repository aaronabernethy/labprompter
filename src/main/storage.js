const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  fontSize: 56,
  allCaps: false,
  lineHeight: 1.45,
  textWidthPct: 92,
  readingLinePct: 35,
  showProgress: true,
  autoMoveDisplay: true,
  displayMode: 'mirrored',
  baseSpeedPct: 10,
  shuttleSens: 100,
  jogSens: 100,
  wpm: 150,
  allowRemote: true,
  lastScriptId: null,
  buttonMap: {
    1: 'jumpTop',
    2: 'prevMarker',
    3: 'playPause',
    4: 'nextMarker',
    5: 'exitPresent',
  },
};

let dirs = null;

function paths() {
  if (!dirs) {
    const root = app.getPath('userData');
    dirs = {
      scripts: path.join(root, 'scripts'),
      settings: path.join(root, 'settings.json'),
    };
    fs.mkdirSync(dirs.scripts, { recursive: true });
  }
  return dirs;
}

function validId(id) {
  return typeof id === 'string' && /^[\w-]+$/.test(id);
}

function scriptPath(id) {
  return path.join(paths().scripts, id + '.json');
}

function countWords(text) {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

// Pre-1.1 settings stored speeds in px/s; percentages replaced them
// (100% base speed = 600 px/s, sensitivities are % of their defaults).
function migrate(data) {
  const d = { ...data };
  if (d.baseSpeed != null && d.baseSpeedPct == null) d.baseSpeedPct = Math.round(d.baseSpeed / 6);
  if (d.maxShuttleSpeed != null && d.shuttleSens == null) d.shuttleSens = Math.round(d.maxShuttleSpeed / 6);
  if (d.jogStep != null && d.jogSens == null) d.jogSens = Math.round((d.jogStep / 48) * 100);
  delete d.baseSpeed;
  delete d.maxShuttleSpeed;
  delete d.jogStep;
  return d;
}

function getSettings() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(paths().settings, 'utf8'));
  } catch {
    data = {};
  }
  data = migrate(data);
  return {
    ...DEFAULTS,
    ...data,
    buttonMap: { ...DEFAULTS.buttonMap, ...(data.buttonMap || {}) },
  };
}

function setSettings(patch) {
  const merged = {
    ...getSettings(),
    ...patch,
    buttonMap: { ...getSettings().buttonMap, ...((patch && patch.buttonMap) || {}) },
  };
  fs.writeFileSync(paths().settings, JSON.stringify(merged, null, 2));
  return merged;
}

function listScripts() {
  const out = [];
  for (const f of fs.readdirSync(paths().scripts)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(paths().scripts, f), 'utf8'));
      out.push({
        id: s.id,
        title: s.title,
        words: s.words || 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    } catch {
      // skip unreadable entries
    }
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

function getScript(id) {
  if (!validId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(scriptPath(id), 'utf8'));
  } catch {
    return null;
  }
}

function createScript({ title, body } = {}) {
  const id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const script = {
    id,
    title: title || 'Untitled',
    body: body || '',
    words: countWords(body),
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(scriptPath(id), JSON.stringify(script, null, 2));
  return script;
}

function saveScript({ id, title, body }) {
  if (!validId(id)) throw new Error('bad script id');
  const existing = getScript(id);
  const now = Date.now();
  const script = {
    id,
    title: title || 'Untitled',
    body: body || '',
    words: countWords(body),
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now,
  };
  fs.writeFileSync(scriptPath(id), JSON.stringify(script, null, 2));
  return { updatedAt: now };
}

function deleteScript(id) {
  if (!validId(id)) return false;
  try {
    fs.unlinkSync(scriptPath(id));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getSettings,
  setSettings,
  listScripts,
  getScript,
  createScript,
  saveScript,
  deleteScript,
};
