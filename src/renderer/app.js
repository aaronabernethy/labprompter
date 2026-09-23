import { renderChunks, buildBackdropHTML, countWords, fmtDuration, fmtTime, measureLines, applyLineVars } from './render.js';
import { Prompter, JOG_BASE_PX } from './present.js';
import { VoiceFollowMatcher, buildWordIndex } from './voice-follow.js';

const lab = window.lab;

const $ = (id) => document.getElementById(id);
const els = {
  scriptTitle: $('scriptTitle'),
  saveState: $('saveState'),
  btnLibrary: $('btnLibrary'),
  btnImport: $('btnImport'),
  btnSettings: $('btnSettings'),
  btnPresent: $('btnPresent'),
  libraryPanel: $('libraryPanel'),
  scriptList: $('scriptList'),
  btnNew: $('btnNew'),
  tabLibrary: $('tabLibrary'),
  tabSessions: $('tabSessions'),
  libraryLocal: $('libraryLocal'),
  librarySessions: $('librarySessions'),
  btnSessionsRefresh: $('btnSessionsRefresh'),
  sessionsStatus: $('sessionsStatus'),
  sessionList: $('sessionList'),
  studioDisconnected: $('studioDisconnected'),
  studioConnected: $('studioConnected'),
  studioCode: $('studioCode'),
  studioBaseUrl: $('studioBaseUrl'),
  btnStudioConnect: $('btnStudioConnect'),
  btnStudioDisconnect: $('btnStudioDisconnect'),
  studioStatusText: $('studioStatusText'),
  studioMessage: $('studioMessage'),
  scriptBody: $('scriptBody'),
  backdropContent: $('backdropContent'),
  btnInsertBreak: $('btnInsertBreak'),
  btnInsertDirection: $('btnInsertDirection'),
  stats: $('stats'),
  previewContent: $('previewContent'),
  previewLine: $('previewLine'),
  fontSize: $('fontSize'),
  fontSizeVal: $('fontSizeVal'),
  shuttleStatus: $('shuttleStatus'),
  presentView: $('presentView'),
  promptViewport: $('promptViewport'),
  promptContent: $('promptContent'),
  editMeasure: $('editMeasure'),
  readingLine: $('readingLine'),
  pauseBadge: $('pauseBadge'),
  progressFill: $('progressFill'),
  paceHud: $('paceHud'),
  paceElapsed: $('paceElapsed'),
  paceEstimate: $('paceEstimate'),
  paceDelta: $('paceDelta'),
  voiceHud: $('voiceHud'),
  btnVoiceToggle: $('btnVoiceToggle'),
  voiceStatus: $('voiceStatus'),
  settingsModal: $('settingsModal'),
  btnCloseSettings: $('btnCloseSettings'),
  buttonRows: $('buttonRows'),
  btnRemote: $('btnRemote'),
  remoteModal: $('remoteModal'),
  btnCloseRemote: $('btnCloseRemote'),
  remoteList: $('remoteList'),
  remoteModalStatus: $('remoteModalStatus'),
  remoteHost: $('remoteHost'),
  btnRemoteConnectManual: $('btnRemoteConnectManual'),
  remoteView: $('remoteView'),
  remoteTarget: $('remoteTarget'),
  remoteBadge: $('remoteBadge'),
  remoteSpeed: $('remoteSpeed'),
  btnRemotePresent: $('btnRemotePresent'),
  btnRemoteDisconnect: $('btnRemoteDisconnect'),
  remoteStage: $('remoteStage'),
  remoteScreen: $('remoteScreen'),
  remoteContent: $('remoteContent'),
  remoteLine: $('remoteLine'),
  remoteProgressFill: $('remoteProgressFill'),
  remoteOverlay: $('remoteOverlay'),
  btnRemoteEdit: $('btnRemoteEdit'),
  remoteEditPane: $('remoteEditPane'),
  remoteEditor: $('remoteEditor'),
};

let settings = null;
let current = null;
let dirty = false;
let saveTimer = null;
let previewTimer = null;
let settingsTimer = null;
let stateTimer = null;

// Live pacing readout while presenting: how long we've been reading vs. how
// long the script should take, adapting to the talent's actual pace once
// there's enough signal rather than sticking to the configured wpm forever.
let presentStartTs = 0;
let presentTotalWords = 0;

// Client-side state when this instance is controlling another one.
const rc = { mode: false, doc: null, state: null, stateAt: 0, raf: null };

// StudioOS connection + the Sessions tab cache (the token itself stays in main).
const studio = { status: null, sessions: null, fetchedAt: 0, loading: false, error: null };
const SESSIONS_STALE_MS = 60 * 1000;

const P = new Prompter(els, () => settings, {
  onExit: () => exitPresent(),
  adjustBaseSpeed: (d) => adjustBaseSpeed(d),
  adjustFontSize: (d) => adjustFontSize(d),
  adjustEyeLine: (d) => adjustEyeLine(d),
  toggleCaps: () => setAllCaps(!settings.allCaps),
  onPlayState: () => pushState(),
});

function pushState() {
  lab.state({
    presenting: P.active,
    playing: P.playing,
    pos: P.pos,
    max: P.max,
    speed: P.active ? P.speed() : 0,
    baseSpeedPct: settings.baseSpeedPct,
  });
  updatePaceHud();
}

// Adaptive pace: once the talent has read enough for their actual rate to
// mean something, the remaining-time estimate switches from the configured
// wpm to how fast they're really going. The delta badge always compares
// against the configured wpm, since that's the target being kept to.
const PACE_ADAPT_MIN_SEC = 15;
const PACE_ADAPT_MIN_WORDS = 20;

function updatePaceHud() {
  if (!P.active || !settings.showPaceTimer) return;
  const elapsedSec = (performance.now() - presentStartTs) / 1000;
  const targetWps = settings.wpm / 60;
  const fraction = P.max ? P.pos / P.max : 0;
  const wordsRead = fraction * presentTotalWords;

  const adapt = elapsedSec >= PACE_ADAPT_MIN_SEC && wordsRead >= PACE_ADAPT_MIN_WORDS;
  const paceWps = adapt ? wordsRead / elapsedSec : targetWps;
  const remainingWords = Math.max(0, presentTotalWords - wordsRead);
  const remainingSec = paceWps > 0 ? remainingWords / paceWps : 0;

  els.paceElapsed.textContent = fmtDuration(elapsedSec);
  els.paceEstimate.textContent = '~' + fmtDuration(elapsedSec + remainingSec);

  const expectedWords = targetWps * elapsedSec;
  const deltaSec = targetWps > 0 ? (wordsRead - expectedWords) / targetWps : 0;
  els.paceDelta.classList.toggle('ahead', deltaSec >= 1);
  els.paceDelta.classList.toggle('behind', deltaSec <= -1);
  els.paceDelta.textContent = Math.abs(deltaSec) < 1 ? '' : (deltaSec > 0 ? '+' : '-') + fmtDuration(Math.abs(deltaSec));
}

function pushDoc() {
  lab.remote.pushDoc({
    title: current ? current.title : '',
    body: els.scriptBody.value,
    vw: window.innerWidth,
    vh: window.innerHeight,
    s: {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      textWidthPct: settings.textWidthPct,
      readingLinePct: settings.readingLinePct,
      lineStyle: settings.lineStyle,
      lineColor: settings.lineColor,
      lineThicknessPx: settings.lineThicknessPx,
      barHeightPct: settings.barHeightPct,
      lineOpacity: settings.lineOpacity,
      allCaps: settings.allCaps,
      showProgress: settings.showProgress,
    },
  });
}

function adjustBaseSpeed(d) {
  settings.baseSpeedPct = Math.min(100, Math.max(1, settings.baseSpeedPct + d));
  syncSettingsUI();
  persistSettings();
}

function adjustEyeLine(d) {
  settings.readingLinePct = Math.min(70, Math.max(10, settings.readingLinePct + d));
  applyPromptVars();
  syncSettingsUI();
  persistSettings();
  if (P.active) P.measure();
}

function adjustFontSize(d) {
  settings.fontSize = Math.min(120, Math.max(24, settings.fontSize + d));
  applyPromptVars();
  syncSettingsUI();
  persistSettings();
  P.remeasurePreserve();
}

function setAllCaps(on) {
  settings.allCaps = on;
  applyPromptVars();
  syncSettingsUI();
  persistSettings();
  P.remeasurePreserve();
}

const ACTIONS = {
  none: { label: 'Do nothing', run: () => {} },
  playPause: { label: 'Play / pause', run: () => P.toggle() },
  nextMarker: { label: 'Next marker', run: () => P.next() },
  prevMarker: { label: 'Previous marker', run: () => P.prev() },
  toggleReverse: { label: 'Toggle reverse', run: () => P.reverse() },
  jumpTop: { label: 'Jump to top', run: () => P.toTop() },
  fontUp: { label: 'Text size +', run: () => adjustFontSize(2) },
  fontDown: { label: 'Text size −', run: () => adjustFontSize(-2) },
  speedUp: { label: 'Base speed +', run: () => adjustBaseSpeed(2) },
  speedDown: { label: 'Base speed −', run: () => adjustBaseSpeed(-2) },
  eyeLineUp: { label: 'Eye line up', run: () => adjustEyeLine(-1) },
  eyeLineDown: { label: 'Eye line down', run: () => adjustEyeLine(1) },
  toggleCaps: { label: 'Toggle ALL CAPS', run: () => setAllCaps(!settings.allCaps) },
  exitPresent: { label: 'Exit Present Mode', run: () => exitPresent() },
};

const STARTER_BODY = `Welcome to LabPrompter.

This is your script area. Paste from anywhere — formatting is stripped automatically.

---

Lines with three dashes (or [BREAK]) become jump markers.

In Present Mode, use Page Up / Page Down — or your shuttle controller's buttons — to jump between them.

---

Connect a Contour ShuttleXpress and twist the outer ring to scroll. The further you twist, the faster it goes. Release it to stop.

Press Cmd+Return to try Present Mode. Esc brings you back here.
`;

// ---------- Settings ----------

function applyPromptVars() {
  const r = document.documentElement.style;
  r.setProperty('--pfs', settings.fontSize + 'px');
  r.setProperty('--plh', settings.lineHeight);
  r.setProperty('--ptw', settings.textWidthPct + '%');
  els.readingLine.style.top = settings.readingLinePct + '%';
  els.previewLine.style.top = settings.readingLinePct + '%';
  applyLineVars(els.readingLine, settings);
  applyLineVars(els.previewLine, settings);
  els.presentView.classList.toggle('no-progress', !settings.showProgress);
  els.presentView.classList.toggle('no-pace', !settings.showPaceTimer);
  document.body.classList.toggle('all-caps', settings.allCaps);
}

function persistSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    lab.settings.set(settings);
    pushDoc();
  }, 400);
}

const SETTING_CONTROLS = [
  { id: 'fontSize', key: 'fontSize', out: 'fontSizeVal', fmt: (v) => v + 'px' },
  { id: 'setLineHeight', key: 'lineHeight', fmt: (v) => Number(v).toFixed(2) },
  { id: 'setTextWidth', key: 'textWidthPct', fmt: (v) => v + '%' },
  { id: 'setLinePct', key: 'readingLinePct', fmt: (v) => v + '%' },
  { id: 'setLineThick', key: 'lineThicknessPx', fmt: (v) => v + ' px' },
  { id: 'setBarHeight', key: 'barHeightPct', fmt: (v) => v + '%' },
  { id: 'setLineOpacity', key: 'lineOpacity', fmt: (v) => v + '%' },
  { id: 'setBaseSpeed', key: 'baseSpeedPct', fmt: (v) => v + '%' },
  { id: 'setMaxShuttle', key: 'shuttleSens', fmt: (v) => v + '%' },
  { id: 'setJogStep', key: 'jogSens', fmt: (v) => v + '%' },
  { id: 'setWpm', key: 'wpm', fmt: (v) => v + ' wpm' },
];

function syncSettingsUI() {
  for (const c of SETTING_CONTROLS) {
    const input = $(c.id);
    input.value = settings[c.key];
    const out = c.out ? $(c.out) : document.querySelector(`[data-out="${c.id}"]`);
    if (out) out.textContent = c.fmt(settings[c.key]);
  }
  $('setShowProgress').checked = settings.showProgress;
  $('setShowPaceTimer').checked = settings.showPaceTimer;
  $('setVoiceFollow').checked = settings.voiceFollowEnabled;
  $('setDisplayMode').value = settings.displayMode === 'extended' ? 'extended' : 'mirrored';
  $('setAutoMove').checked = settings.autoMoveDisplay;
  $('setAllowRemote').checked = settings.allowRemote;
  $('capsToggle').checked = settings.allCaps;
  $('setLineStyle').value = settings.lineStyle === 'bar' ? 'bar' : 'line';
  $('setLineColor').value = settings.lineColor;
  syncDisplayModeUI();
  syncLineStyleUI();
}

const LINE_SWATCHES = ['#ffa836', '#ff4b4b', '#ffd60a', '#3fd268', '#38d1e0', '#e35bd8', '#ffffff'];

function syncLineStyleUI() {
  const bar = settings.lineStyle === 'bar';
  $('rowLineThick').hidden = bar;
  $('rowBarHeight').hidden = !bar;
  for (const b of document.querySelectorAll('#lineSwatches .swatch')) {
    b.classList.toggle('selected', b.dataset.color.toLowerCase() === (settings.lineColor || '').toLowerCase());
  }
}

function setLineColor(color) {
  settings.lineColor = color;
  $('setLineColor').value = color;
  syncLineStyleUI();
  applyPromptVars();
  persistSettings();
}

function syncDisplayModeUI() {
  const extended = settings.displayMode === 'extended';
  $('rowAutoMove').hidden = extended;
  $('extendedModeNote').hidden = !extended;
}

function wireSettings() {
  for (const c of SETTING_CONTROLS) {
    const input = $(c.id);
    input.addEventListener('input', () => {
      settings[c.key] = Number(input.value);
      const out = c.out ? $(c.out) : document.querySelector(`[data-out="${c.id}"]`);
      if (out) out.textContent = c.fmt(settings[c.key]);
      applyPromptVars();
      updateStats();
      persistSettings();
    });
  }
  $('setShowProgress').addEventListener('change', (e) => {
    settings.showProgress = e.target.checked;
    applyPromptVars();
    persistSettings();
  });
  $('setShowPaceTimer').addEventListener('change', (e) => {
    settings.showPaceTimer = e.target.checked;
    applyPromptVars();
    persistSettings();
  });
  $('setVoiceFollow').addEventListener('change', (e) => {
    settings.voiceFollowEnabled = e.target.checked;
    syncVoiceUI();
    persistSettings();
  });
  $('setDisplayMode').addEventListener('change', (e) => {
    settings.displayMode = e.target.value;
    syncDisplayModeUI();
    persistSettings();
  });
  $('setAutoMove').addEventListener('change', (e) => {
    settings.autoMoveDisplay = e.target.checked;
    persistSettings();
  });
  $('setAllowRemote').addEventListener('change', (e) => {
    settings.allowRemote = e.target.checked;
    persistSettings();
  });
  $('capsToggle').addEventListener('change', (e) => setAllCaps(e.target.checked));
  $('setLineStyle').addEventListener('change', (e) => {
    settings.lineStyle = e.target.value;
    syncLineStyleUI();
    applyPromptVars();
    persistSettings();
  });
  $('setLineColor').addEventListener('input', (e) => setLineColor(e.target.value));
  const swatches = $('lineSwatches');
  for (const color of LINE_SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = color;
    b.style.background = color;
    b.title = color;
    b.addEventListener('click', () => setLineColor(color));
    swatches.appendChild(b);
  }
}

// ---------- Button mapping ----------

function renderButtonRows(flashButton) {
  els.buttonRows.innerHTML = '';
  const nums = Object.keys(settings.buttonMap)
    .map(Number)
    .sort((a, b) => a - b);
  for (const n of nums) {
    const row = document.createElement('div');
    row.className = 'btn-row' + (n === flashButton ? ' flash' : '');
    const name = document.createElement('span');
    name.className = 'btn-name';
    name.textContent = `Button ${n}`;
    const select = document.createElement('select');
    for (const [key, a] of Object.entries(ACTIONS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = a.label;
      select.appendChild(opt);
    }
    select.value = settings.buttonMap[n] in ACTIONS ? settings.buttonMap[n] : 'none';
    select.addEventListener('change', () => {
      settings.buttonMap[n] = select.value;
      persistSettings();
    });
    row.append(name, select);
    els.buttonRows.appendChild(row);
  }
}

function flashButtonRow(n) {
  if (!(n in settings.buttonMap)) {
    settings.buttonMap[n] = 'none';
    persistSettings();
  }
  renderButtonRows(n);
  setTimeout(() => renderButtonRows(), 600);
}

// ---------- Scripts ----------

function setSaveState(text) {
  els.saveState.textContent = text;
}

function markDirty() {
  dirty = true;
  setSaveState('Editing…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 700);
}

async function doSave() {
  if (!current || !dirty) return;
  dirty = false;
  const { updatedAt } = await lab.scripts.save({
    id: current.id,
    title: current.title,
    body: current.body,
  });
  setSaveState('Saved ' + fmtTime(updatedAt));
  pushDoc();
  if (!els.libraryPanel.hidden && !els.libraryLocal.hidden) refreshLibrary();
}

function flushSave() {
  clearTimeout(saveTimer);
  if (dirty && current) {
    dirty = false;
    lab.scripts.saveNow({ id: current.id, title: current.title, body: current.body });
    setSaveState('Saved ' + fmtTime(Date.now()));
  }
}

function updateWindowTitle() {
  document.title = current ? `${current.title || 'Untitled'} — LabPrompter` : 'LabPrompter';
}

function openScript(script) {
  flushSave();
  current = script;
  els.scriptTitle.value = script.title;
  els.scriptBody.value = script.body;
  els.scriptBody.scrollTop = 0;
  updateWindowTitle();
  refreshEditorViews();
  settings.lastScriptId = script.id;
  persistSettings();
  pushDoc();
  if (!els.libraryPanel.hidden) {
    if (els.libraryLocal.hidden) refreshSessions();
    else refreshLibrary();
  }
}

async function refreshLibrary() {
  const list = await lab.scripts.list();
  els.scriptList.innerHTML = '';
  for (const item of list) {
    const li = document.createElement('li');
    li.classList.toggle('active', current && item.id === current.id);

    const info = document.createElement('div');
    info.className = 'script-info';
    const title = document.createElement('div');
    title.className = 'script-title';
    title.textContent = item.title || 'Untitled';
    title.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(item, title);
    });
    const meta = document.createElement('div');
    meta.className = 'script-meta';
    meta.textContent = `${item.words} words · ${fmtTime(item.updatedAt)}`;
    if (item.source && item.source.kind === 'studio') {
      const tag = document.createElement('span');
      tag.className = 'script-tag';
      tag.textContent = 'StudioOS';
      tag.title = item.source.clientName ? `Loaded from StudioOS — ${item.source.clientName}` : 'Loaded from StudioOS';
      meta.appendChild(tag);
    }
    info.append(title, meta);

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Delete script';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.textContent = 'Delete?';
        setTimeout(() => {
          del.classList.remove('armed');
          del.textContent = '✕';
        }, 2500);
        return;
      }
      await lab.scripts.remove(item.id);
      if (current && current.id === item.id) {
        const rest = await lab.scripts.list();
        if (rest.length) {
          openScript(await lab.scripts.get(rest[0].id));
        } else {
          openScript(await lab.scripts.create({ title: 'Untitled' }));
        }
      }
      refreshLibrary();
    });

    li.append(info, del);
    li.addEventListener('click', async () => {
      if (current && item.id === current.id) return;
      const s = await lab.scripts.get(item.id);
      if (s) openScript(s);
    });
    els.scriptList.appendChild(li);
  }
}

// Finder-style rename: double-click the name, type, Enter commits, Esc cancels.
function startRename(item, titleEl) {
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = item.title || 'Untitled';
  input.spellcheck = false;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const name = input.value.trim() || 'Untitled';
    if (name !== item.title) {
      if (current && current.id === item.id) {
        current.title = name;
        els.scriptTitle.value = name;
        updateWindowTitle();
        markDirty();
        flushSave();
      } else {
        const s = await lab.scripts.get(item.id);
        if (s) await lab.scripts.save({ id: s.id, title: name, body: s.body });
      }
    }
    refreshLibrary();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    refreshLibrary();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') cancel();
  });
  input.addEventListener('blur', () => commit());
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function newScript() {
  const s = await lab.scripts.create({ title: 'Untitled' });
  openScript(s);
  els.scriptTitle.focus();
  els.scriptTitle.select();
}

async function importScript() {
  const res = await lab.scripts.importFile();
  if (!res) return;
  const s = await lab.scripts.create(res);
  openScript(s);
}

async function duplicateScript() {
  if (!current) return;
  flushSave();
  const s = await lab.scripts.create({ title: current.title + ' copy', body: current.body });
  openScript(s);
  els.scriptTitle.focus();
  els.scriptTitle.select();
}

// ---------- Library tabs + StudioOS sessions ----------

function setLibraryTab(tab) {
  const sessions = tab === 'sessions';
  els.tabLibrary.classList.toggle('active', !sessions);
  els.tabSessions.classList.toggle('active', sessions);
  els.libraryLocal.hidden = sessions;
  els.librarySessions.hidden = !sessions;
  if (settings.libraryTab !== tab) {
    settings.libraryTab = tab;
    persistSettings();
  }
  if (sessions) refreshSessions();
  else refreshLibrary();
}

function fmtSessionWhen(startIso, endIso) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return '';
  const day = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const end = endIso ? new Date(endIso) : null;
  return end && !Number.isNaN(end.getTime()) ? `${day} · ${time(start)}–${time(end)}` : `${day} · ${time(start)}`;
}

function showSessionsStatus(message, { error = false, action = null } = {}) {
  els.sessionsStatus.hidden = false;
  els.sessionsStatus.classList.toggle('error', error);
  els.sessionsStatus.textContent = '';
  const text = document.createElement('div');
  text.textContent = message;
  els.sessionsStatus.appendChild(text);
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = action.label;
    b.addEventListener('click', action.onClick);
    els.sessionsStatus.appendChild(b);
  }
}

async function refreshStudioStatus() {
  studio.status = await lab.studio.status();
  return studio.status;
}

async function refreshSessions(force = false) {
  if (studio.loading) return;
  const st = studio.status || (await refreshStudioStatus());
  if (!st.connected) {
    studio.sessions = null;
    els.sessionList.innerHTML = '';
    showSessionsStatus('Not connected to StudioOS. Pair this Mac in Settings to see upcoming sessions and their scripts.', {
      action: { label: 'Open Settings', onClick: () => openSettings() },
    });
    return;
  }
  const fresh = studio.sessions && Date.now() - studio.fetchedAt < SESSIONS_STALE_MS;
  if (fresh && !force) {
    renderSessions();
    return;
  }
  studio.loading = true;
  els.btnSessionsRefresh.disabled = true;
  if (!studio.sessions) showSessionsStatus('Loading sessions from StudioOS…');
  try {
    const res = await lab.studio.sessions();
    if (res.ok) {
      studio.sessions = res.sessions;
      studio.fetchedAt = res.fetchedAt || Date.now();
      studio.error = null;
      renderSessions();
    } else {
      studio.error = res;
      if (res.code === 'revoked' || res.code === 'unauthorised') {
        studio.status = await refreshStudioStatus();
        studio.sessions = null;
        els.sessionList.innerHTML = '';
        showSessionsStatus(res.error, { error: true, action: { label: 'Open Settings', onClick: () => openSettings() } });
      } else if (studio.sessions) {
        // Keep the last good list; say it's stale.
        renderSessions();
        showSessionsStatus(`${res.error} Showing the last list from ${fmtTime(studio.fetchedAt)}.`, { error: true });
      } else {
        showSessionsStatus(res.error, { error: true, action: { label: 'Try again', onClick: () => refreshSessions(true) } });
      }
    }
  } finally {
    studio.loading = false;
    els.btnSessionsRefresh.disabled = false;
  }
}

async function renderSessions() {
  const list = await lab.scripts.list();
  const localByStudioId = new Map();
  for (const item of list) {
    if (item.source && item.source.kind === 'studio' && item.source.scriptId) {
      localByStudioId.set(item.source.scriptId, item);
    }
  }

  els.sessionsStatus.hidden = true;
  els.sessionList.innerHTML = '';
  const sessions = studio.sessions || [];
  if (!sessions.length) {
    showSessionsStatus('No upcoming sessions in the next two weeks.');
    return;
  }

  for (const session of sessions) {
    const group = document.createElement('div');
    group.className = 'session-group';

    const head = document.createElement('div');
    head.className = 'session-head';
    const client = document.createElement('div');
    client.className = 'session-client';
    client.textContent = session.clientName || 'Session';
    const when = document.createElement('div');
    when.className = 'session-when';
    when.textContent = fmtSessionWhen(session.startTime, session.endTime);
    head.append(client, when);
    group.appendChild(head);

    if (!session.scripts || !session.scripts.length) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = 'No scripts attached yet';
      group.appendChild(empty);
    }

    for (const script of session.scripts || []) {
      const row = document.createElement('div');
      row.className = 'session-script';
      const local = localByStudioId.get(script.id);
      row.classList.toggle('active', Boolean(local && current && local.id === current.id));

      const info = document.createElement('div');
      info.className = 'script-info';
      const title = document.createElement('div');
      title.className = 'script-title';
      title.textContent = script.title || 'Untitled';
      const meta = document.createElement('div');
      meta.className = 'script-meta';
      const bits = [`${script.words} words`];
      if (script.estimatedMinutes) bits.push(`est. ${script.estimatedMinutes} min`);
      meta.textContent = bits.join(' · ');
      info.append(title, meta);

      const state = document.createElement('span');
      state.className = 'state';
      if (local) {
        const localStamp = (local.source && local.source.updatedAt) || '';
        const updateAvailable = script.updatedAt && script.updatedAt > localStamp;
        state.classList.add(updateAvailable ? 'update' : 'loaded');
        state.textContent = updateAvailable ? 'Update' : 'Loaded';
        state.title = updateAvailable
          ? 'Edited in StudioOS since you loaded it — click to load the latest wording'
          : 'Already in your library — click to open';
      } else {
        state.textContent = 'Load';
        state.title = 'Load this script into the prompter';
      }

      row.append(info, state);
      row.addEventListener('click', () => loadStudioScript(session, script));
      group.appendChild(row);
    }
    els.sessionList.appendChild(group);
  }
}

// Load (or refresh) a StudioOS script as a local library script and open it.
// StudioOS is the source of truth for wording: if the server copy is newer
// than what we loaded, it replaces the local text. Local edits made since
// loading survive until the script changes upstream.
async function loadStudioScript(session, script) {
  flushSave();
  const list = await lab.scripts.list();
  const existing = list.find((s) => s.source && s.source.kind === 'studio' && s.source.scriptId === script.id);
  const source = {
    kind: 'studio',
    scriptId: script.id,
    clipId: script.clipId || null,
    bookingId: session.id,
    clientName: session.clientName || null,
    sessionStart: session.startTime || null,
    updatedAt: script.updatedAt || null,
    version: script.version || null,
    loadedAt: Date.now(),
  };

  let target;
  if (existing) {
    target = await lab.scripts.get(existing.id);
    const localStamp = (target && target.source && target.source.updatedAt) || '';
    const upstreamNewer = !target || (script.updatedAt && script.updatedAt > localStamp);
    if (target && upstreamNewer) {
      target.title = script.title || target.title;
      target.body = script.text || '';
      target.source = source;
      await lab.scripts.save({ id: target.id, title: target.title, body: target.body, source });
    }
  }
  if (!target) {
    target = await lab.scripts.create({ title: script.title || 'Untitled', body: script.text || '', source });
  }
  openScript(target); // re-renders the Sessions tab (Loaded / active state)
}

// ---------- StudioOS settings ----------

function showStudioMessage(text, tone) {
  els.studioMessage.hidden = !text;
  els.studioMessage.textContent = text || '';
  els.studioMessage.classList.toggle('error', tone === 'error');
  els.studioMessage.classList.toggle('ok', tone === 'ok');
}

async function syncStudioSettingsUI() {
  const st = await refreshStudioStatus();
  els.studioDisconnected.hidden = st.connected;
  els.studioConnected.hidden = !st.connected;
  if (st.connected) {
    els.studioStatusText.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = st.revoked ? 'warn' : 'ok';
    dot.textContent = st.revoked ? '● Deregistered' : '● Connected';
    const name = document.createElement('span');
    name.textContent = ` as “${st.deviceName}”`;
    els.studioStatusText.append(dot, name);
    if (st.revoked) {
      showStudioMessage('StudioOS has deregistered this device. Disconnect, then pair again with a fresh code.', 'error');
    }
  } else if (!els.studioBaseUrl.value) {
    els.studioBaseUrl.value = st.baseUrl || '';
  }
}

function formatPairInput() {
  const raw = els.studioCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  els.studioCode.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

async function connectStudio() {
  const code = els.studioCode.value.trim();
  if (!code) {
    els.studioCode.focus();
    return;
  }
  els.btnStudioConnect.disabled = true;
  showStudioMessage('Connecting…');
  try {
    const res = await lab.studio.pair(code, els.studioBaseUrl.value);
    if (res.ok) {
      els.studioCode.value = '';
      studio.sessions = null;
      await syncStudioSettingsUI();
      showStudioMessage(`Connected as “${res.status.deviceName}”. Open Library → Sessions to see upcoming scripts.`, 'ok');
      if (!els.librarySessions.hidden) refreshSessions(true);
    } else {
      showStudioMessage(res.error || 'Pairing failed.', 'error');
    }
  } finally {
    els.btnStudioConnect.disabled = false;
  }
}

async function disconnectStudio() {
  await lab.studio.disconnect();
  studio.sessions = null;
  studio.error = null;
  showStudioMessage('Disconnected. Scripts already in your library stay where they are.');
  await syncStudioSettingsUI();
  if (!els.librarySessions.hidden) refreshSessions();
}

function wireStudio() {
  els.tabLibrary.addEventListener('click', () => setLibraryTab('library'));
  els.tabSessions.addEventListener('click', () => setLibraryTab('sessions'));
  els.btnSessionsRefresh.addEventListener('click', () => refreshSessions(true));
  els.studioCode.addEventListener('input', formatPairInput);
  els.studioCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connectStudio();
    }
  });
  els.btnStudioConnect.addEventListener('click', connectStudio);
  els.btnStudioDisconnect.addEventListener('click', disconnectStudio);
}

// ---------- Editor rendering ----------

function updateBackdrop() {
  els.backdropContent.innerHTML = buildBackdropHTML(els.scriptBody.value);
}

function syncBackdropScroll() {
  els.backdropContent.style.transform = `translateY(${-els.scriptBody.scrollTop}px)`;
}

function updatePreview() {
  renderChunks(els.scriptBody.value, els.previewContent);
}

function updateStats() {
  const words = countWords(els.scriptBody.value);
  const secs = (words / settings.wpm) * 60;
  els.stats.textContent = words
    ? `${words} words · ≈ ${fmtDuration(secs)} at ${settings.wpm} wpm`
    : 'No script yet';
}

function refreshEditorViews() {
  updateBackdrop();
  syncBackdropScroll();
  updatePreview();
  updateStats();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    updatePreview();
    updateStats();
  }, 150);
}

function insertBreak() {
  const ta = els.scriptBody;
  const { selectionStart: st, selectionEnd: en, value } = ta;
  const before = value.slice(0, st);
  const after = value.slice(en);
  const ins = (before && !before.endsWith('\n') ? '\n' : '') + '---' + (after.startsWith('\n') || !after ? '' : '\n');
  ta.setRangeText(ins, st, en, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

function insertDirection() {
  const ta = els.scriptBody;
  const { selectionStart: st, selectionEnd: en, value } = ta;
  const selected = value.slice(st, en);
  const placeholder = 'camera note';
  const note = selected || placeholder;
  ta.setRangeText(`[[${note}]]`, st, en, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
  if (!selected) ta.setSelectionRange(st + 2, st + 2 + placeholder.length);
}

// ---------- Present mode ----------

async function enterPresent() {
  if (P.active) return;
  flushSave();
  closeSettings();
  renderChunks(els.scriptBody.value, els.promptContent);
  applyPromptVars();
  presentStartTs = performance.now();
  presentTotalWords = countWords(els.scriptBody.value);
  document.body.dataset.view = 'present';
  try {
    await lab.present.enter();
  } catch {
    // present anyway in the current window
  }
  requestAnimationFrame(() => {
    P.enter();
    pushState();
    pushDoc();
    syncVoiceUI();
  });
  clearInterval(stateTimer);
  stateTimer = setInterval(pushState, 100);
}

function exitPresent() {
  if (!P.active) return;
  stopVoiceListening();
  clearInterval(stateTimer);
  stateTimer = null;
  P.exit();
  document.body.dataset.view = 'editor';
  lab.present.exit();
  pushState();
  els.scriptBody.focus();
}

// ---------- Voice-follow ----------
// The talent's own voice drives the scroll instead of a fixed speed: the
// native speech-helper (macOS on-device Speech framework, see
// src/main/voice.js) reports recognized text, which is matched against the
// script here and turned into a scroll target for the Prompter (see
// VOICE_GAIN in present.js). Off by default; the mic only opens once the
// setting is on AND the talent presses the listening toggle in Present Mode.

const voiceState = { listening: false, status: 'idle', error: '', matcher: null };

function voiceAvailable() {
  return settings.voiceFollowEnabled && lab.platform === 'darwin';
}

function buildVoiceMatcher(bodyText) {
  const lines = measureLines(bodyText, els.editMeasure);
  els.editMeasure.innerHTML = '';
  return new VoiceFollowMatcher(buildWordIndex(lines));
}

const VOICE_STATUS_LABELS = {
  idle: 'Voice-follow',
  starting: 'Starting…',
  listening: 'Listening…',
};

function syncVoiceUI() {
  const show = voiceAvailable() && P.active;
  els.voiceHud.hidden = !show;
  if (!show) return;
  els.btnVoiceToggle.classList.toggle('on', voiceState.listening);
  els.voiceStatus.textContent =
    voiceState.status === 'error' ? voiceState.error || 'Voice-follow error' : VOICE_STATUS_LABELS[voiceState.status] || '';
  els.voiceStatus.classList.toggle('error', voiceState.status === 'error');
}

async function toggleVoiceListening() {
  if (!voiceAvailable()) return;
  if (voiceState.listening) {
    stopVoiceListening();
    return;
  }
  voiceState.matcher = buildVoiceMatcher(els.scriptBody.value);
  voiceState.status = 'starting';
  voiceState.error = '';
  syncVoiceUI();
  const res = await lab.voice.start();
  if (!res || !res.ok) {
    voiceState.status = 'error';
    voiceState.error = (res && res.error) || 'Could not start voice-follow.';
    syncVoiceUI();
    return;
  }
  voiceState.listening = true;
  syncVoiceUI();
}

function stopVoiceListening() {
  if (!voiceState.listening && voiceState.status === 'idle') return;
  lab.voice.stop();
  voiceState.listening = false;
  voiceState.status = 'idle';
  voiceState.matcher = null;
  P.setVoiceTarget(null);
  syncVoiceUI();
}

const VOICE_PERMISSION_MESSAGES = {
  microphone: 'Microphone access denied — check System Settings → Privacy & Security → Microphone.',
  speech: 'Speech recognition access denied — check System Settings → Privacy & Security → Speech Recognition.',
};

function handleVoiceEvent(ev) {
  switch (ev.type) {
    case 'ready':
      voiceState.status = 'listening';
      break;
    case 'partial':
    case 'final': {
      const target = voiceState.matcher ? voiceState.matcher.feed(ev.text) : null;
      if (target != null) P.setVoiceTarget(target);
      break;
    }
    case 'permission-denied':
      voiceState.listening = false;
      voiceState.status = 'error';
      voiceState.error = VOICE_PERMISSION_MESSAGES[ev.stage] || 'Permission denied.';
      P.setVoiceTarget(null);
      break;
    case 'error':
      voiceState.status = 'error';
      voiceState.error = ev.message || 'Voice-follow error.';
      break;
    case 'stopped':
      voiceState.listening = false;
      voiceState.status = 'idle';
      P.setVoiceTarget(null);
      break;
    default:
      return;
  }
  syncVoiceUI();
}

// ---------- Live editing while presenting ----------

// A body edit arriving from the Operator View: update the script exactly as
// if it were typed in the editor, and if Present Mode is up, reflow the
// prompter in place without disturbing the talent's reading position.
function applyLiveEdit(newBody) {
  if (!current || typeof newBody !== 'string') return;
  const oldBody = current.body;
  if (newBody === oldBody) return;
  if (P.active) {
    reflowPresent(oldBody, newBody);
    presentTotalWords = countWords(newBody);
    if (voiceState.listening) {
      // Keep roughly the same read-through progress in the rebuilt word
      // index rather than resetting to the start of the (now different)
      // script.
      const oldWords = voiceState.matcher ? voiceState.matcher.words.length : 0;
      const fraction = oldWords ? (voiceState.matcher.cursor + 1) / oldWords : 0;
      voiceState.matcher = buildVoiceMatcher(newBody);
      voiceState.matcher.cursor = Math.max(-1, Math.round(fraction * voiceState.matcher.words.length) - 1);
    }
  }
  current.body = newBody;
  els.scriptBody.value = newBody;
  markDirty();
  updateBackdrop();
  schedulePreview();
  pushDoc();
}

// Re-render the prompt content keeping the reading line on the same text:
// an edit below the reading position changes nothing above it, so the
// position stays; an edit above shifts everything under it by the height
// delta, so the position shifts with it (anchoring the unchanged tail).
function reflowPresent(oldBody, newBody) {
  const oldLines = measureLines(oldBody, els.editMeasure);
  const a = oldBody.replace(/\r\n?/g, '\n').split('\n');
  const b = newBody.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const changed = oldLines.find((l) => l.line >= i);
  const changeY = changed ? changed.top : P.max;
  const oldMax = P.max;
  const oldPos = P.pos;
  P.tween = null;
  renderChunks(newBody, els.promptContent);
  P.measure();
  P.pos = changeY < oldPos ? oldPos + (P.max - oldMax) : oldPos;
  P.pos = Math.max(0, Math.min(P.max, P.pos));
  P.apply();
  els.editMeasure.innerHTML = '';
}

// Commands arriving over the local control API (Stream Deck, curl, …).
function handleRemote(action) {
  if (action === 'togglePresent') {
    if (P.active) exitPresent();
    else enterPresent();
    return;
  }
  if (action === 'enterPresent') {
    if (!P.active) enterPresent();
    return;
  }
  if (action === 'exitPresent') {
    exitPresent();
    return;
  }
  if (!P.active) return;
  const nudgePx = settings.fontSize * settings.lineHeight;
  switch (action) {
    case 'play':
      P.play();
      break;
    case 'pause':
      P.pause();
      break;
    case 'nudgeDown':
      P.scrub(nudgePx);
      break;
    case 'nudgeUp':
      P.scrub(-nudgePx);
      break;
    case 'jumpEnd':
      P.tweenTo(P.max);
      break;
    case 'scrollDown':
      P.hold(1);
      break;
    case 'scrollUp':
      P.hold(-1);
      break;
    case 'scrollStop':
      P.hold(0);
      break;
    default:
      (ACTIONS[action] || ACTIONS.none).run();
  }
}

// ---------- Remote control (this instance driving another) ----------

function renderRemoteList(list) {
  els.remoteList.innerHTML = '';
  if (!list.length) {
    const none = document.createElement('div');
    none.className = 'none';
    none.textContent = 'No instances found yet — make sure LabPrompter is running on the other Mac.';
    els.remoteList.appendChild(none);
    return;
  }
  for (const svc of list) {
    const item = document.createElement('div');
    item.className = 'remote-item';
    const name = document.createElement('span');
    name.className = 'remote-name';
    name.textContent = svc.name;
    const addr = document.createElement('span');
    addr.className = 'remote-addr';
    addr.textContent = `${svc.host}:${svc.port}`;
    item.append(name, addr);
    item.addEventListener('click', () => connectRemote(svc.host, svc.port));
    els.remoteList.appendChild(item);
  }
}

async function openRemoteModal() {
  els.remoteModalStatus.textContent = '';
  renderRemoteList(await lab.remote.services());
  els.remoteModal.hidden = false;
}

function closeRemoteModal() {
  els.remoteModal.hidden = true;
}

function connectRemote(host, port) {
  els.remoteModalStatus.textContent = `Connecting to ${host}…`;
  lab.remote.connect({ host, port });
}

function enterRemoteView(status) {
  rc.mode = true;
  closeRemoteModal();
  closeSettings();
  els.remoteOverlay.textContent = 'Waiting for Present Mode on the remote…';
  els.remoteTarget.classList.remove('lost');
  els.remoteTarget.textContent = `Controlling ${status.name || status.host}`;
  document.body.dataset.view = 'remote';
  applyRemoteDoc();
  applyRemoteState();
  rescaleRemote();
  cancelAnimationFrame(rc.raf);
  const tick = () => {
    if (!rc.mode) return;
    drawRemote();
    rc.raf = requestAnimationFrame(tick);
  };
  rc.raf = requestAnimationFrame(tick);
}

// User-initiated disconnect: remote.disconnect() silences the socket's
// close/error events (so the "connection lost" status never fires), which
// means the view must be exited from here, not from the status callback.
function disconnectRemote() {
  lab.remote.disconnect();
  rc.doc = null;
  rc.state = null;
  exitRemoteView();
}

function exitRemoteView() {
  if (!rc.mode) return;
  rc.mode = false;
  cancelAnimationFrame(rc.raf);
  els.remoteEditPane.hidden = true;
  els.btnRemoteEdit.classList.remove('primary');
  document.body.dataset.view = 'editor';
  els.scriptBody.focus();
}

// ---- Live editing of the studio script from here ----

let remoteEditTimer = null;

function toggleRemoteEditPane(show) {
  const on = show != null ? show : els.remoteEditPane.hidden;
  els.remoteEditPane.hidden = !on;
  els.btnRemoteEdit.classList.toggle('primary', on);
  if (on) {
    syncRemoteEditor();
    els.remoteEditor.focus();
  }
  requestAnimationFrame(rescaleRemote);
}

// Track the studio's script, but never rewrite the textarea under the
// assistant's cursor: while it has focus, it IS the source.
function syncRemoteEditor() {
  if (!rc.doc) return;
  if (document.activeElement === els.remoteEditor) return;
  if (els.remoteEditor.value !== rc.doc.body) els.remoteEditor.value = rc.doc.body;
}

function flushRemoteEdit() {
  clearTimeout(remoteEditTimer);
  remoteEditTimer = null;
  if (rc.doc && els.remoteEditor.value !== rc.doc.body) {
    lab.remote.send({ t: 'edit', body: els.remoteEditor.value });
  }
}

function applyRemoteDoc() {
  const d = rc.doc;
  if (!d) return;
  const s = d.s;
  els.remoteScreen.style.width = d.vw + 'px';
  els.remoteScreen.style.height = d.vh + 'px';
  els.remoteScreen.style.setProperty('--pfs', s.fontSize + 'px');
  els.remoteScreen.style.setProperty('--plh', s.lineHeight);
  els.remoteScreen.style.setProperty('--ptw', s.textWidthPct + '%');
  els.remoteScreen.classList.toggle('remote-caps', !!s.allCaps);
  els.remoteLine.style.top = s.readingLinePct + '%';
  applyLineVars(els.remoteLine, s);
  renderChunks(d.body, els.remoteContent);
  syncRemoteEditor();
  rescaleRemote();
}

function applyRemoteState() {
  const st = rc.state;
  const presenting = !!(st && st.presenting);
  els.remoteOverlay.classList.toggle('gone', presenting);
  els.remoteBadge.textContent = !st ? '' : presenting ? (st.playing ? '▶ rolling' : '❚❚ paused') : 'in editor';
  els.remoteSpeed.textContent = st && st.baseSpeedPct != null ? `speed ${st.baseSpeedPct}%` : '';
  els.btnRemotePresent.textContent = presenting ? 'Exit Present' : 'Present ▸';
}

function rescaleRemote() {
  const d = rc.doc;
  if (!d) return;
  const sw = els.remoteStage.clientWidth;
  const sh = els.remoteStage.clientHeight;
  const k = Math.min(sw / d.vw, sh / d.vh) || 1;
  els.remoteScreen.style.transform = `scale(${k})`;
  els.remoteScreen.style.left = Math.max(0, (sw - d.vw * k) / 2) + 'px';
  els.remoteScreen.style.top = Math.max(0, (sh - d.vh * k) / 2) + 'px';
}

// Extrapolate between 10Hz state packets so the mirror scrolls smoothly.
function drawRemote() {
  const d = rc.doc;
  const st = rc.state;
  if (!d || !st || !st.presenting) return;
  const dt = (performance.now() - rc.stateAt) / 1000;
  let pos = st.pos + (st.speed || 0) * Math.min(dt, 1);
  pos = Math.max(0, Math.min(st.max || 0, pos));
  const lineY = d.vh * (d.s.readingLinePct / 100);
  els.remoteContent.style.transform = `translate3d(0, ${(lineY - pos).toFixed(2)}px, 0)`;
  els.remoteProgressFill.style.width = (st.max ? (pos / st.max) * 100 : 0) + '%';
}

function handleRemoteKeys(e) {
  if (e.target === els.remoteEditor) {
    if (e.key === 'Escape') {
      flushRemoteEdit();
      els.remoteEditor.blur();
      toggleRemoteEditPane(false);
      e.preventDefault();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const send = (action) => lab.remote.send({ t: 'cmd', action });
  switch (e.key) {
    case ' ':
      send('playPause');
      break;
    case 'ArrowDown':
      send(e.shiftKey ? 'eyeLineDown' : 'nudgeDown');
      break;
    case 'ArrowUp':
      send(e.shiftKey ? 'eyeLineUp' : 'nudgeUp');
      break;
    case 'ArrowRight':
      send('speedUp');
      break;
    case 'ArrowLeft':
      send('speedDown');
      break;
    case 'PageDown':
    case ']':
      send('nextMarker');
      break;
    case 'PageUp':
    case '[':
      send('prevMarker');
      break;
    case 'Home':
      send('jumpTop');
      break;
    case 'End':
      send('jumpEnd');
      break;
    case '-':
    case '_':
      send('fontDown');
      break;
    case '=':
    case '+':
      send('fontUp');
      break;
    case 'c':
    case 'C':
      send('toggleCaps');
      break;
    case 'r':
    case 'R':
      send('toggleReverse');
      break;
    case 'e':
    case 'E':
      toggleRemoteEditPane();
      break;
    case 'Escape':
      disconnectRemote();
      break;
    default:
      return;
  }
  e.preventDefault();
}

// ---------- Shuttle ----------

function renderShuttleStatus(st) {
  const el = els.shuttleStatus;
  const label = el.querySelector('.label');
  el.classList.remove('connected', 'unavailable');
  if (!st.available) {
    el.classList.add('unavailable');
    label.textContent = 'Controller support unavailable';
    el.title = st.error || '';
  } else if (st.connected) {
    el.classList.add('connected');
    label.textContent = `${st.product} connected`;
    el.title = '';
  } else {
    label.textContent = 'No controller';
    el.title = 'Plug in a Contour ShuttleXpress or ShuttlePRO v2';
  }
}

function handleShuttle(ev) {
  if (rc.mode) {
    // Local control surface drives the remote instance instead.
    if (ev.type === 'shuttle') lab.remote.send({ t: 'shuttle', v: ev.value });
    else if (ev.type === 'jog') lab.remote.send({ t: 'jog', d: ev.delta });
    else if (ev.type === 'button') lab.remote.send({ t: 'button', b: ev.button, down: ev.down });
    return;
  }
  if (ev.type === 'shuttle') {
    P.setShuttle(ev.value);
  } else if (ev.type === 'jog') {
    if (P.active) P.scrub(ev.delta * (settings.jogSens / 100) * JOG_BASE_PX);
  } else if (ev.type === 'button' && ev.down) {
    if (!els.settingsModal.hidden) {
      flashButtonRow(ev.button);
      return;
    }
    if (P.active) {
      const action = settings.buttonMap[ev.button] || 'none';
      (ACTIONS[action] || ACTIONS.none).run();
    }
  }
}

// ---------- Modal ----------

function openSettings() {
  syncSettingsUI();
  renderButtonRows();
  showStudioMessage('');
  syncStudioSettingsUI();
  els.settingsModal.hidden = false;
}

function closeSettings() {
  els.settingsModal.hidden = true;
}

// ---------- Wiring ----------

function wireEvents() {
  els.scriptBody.addEventListener('input', () => {
    current.body = els.scriptBody.value;
    markDirty();
    updateBackdrop();
    schedulePreview();
  });
  els.scriptBody.addEventListener('scroll', syncBackdropScroll);

  els.scriptTitle.addEventListener('input', () => {
    current.title = els.scriptTitle.value;
    updateWindowTitle();
    markDirty();
  });
  // Enter commits a rename, per the HIG.
  els.scriptTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      flushSave();
      els.scriptTitle.blur();
      els.scriptBody.focus();
    }
  });

  els.btnInsertBreak.addEventListener('click', insertBreak);
  els.btnInsertDirection.addEventListener('click', insertDirection);
  els.btnPresent.addEventListener('click', enterPresent);
  els.btnNew.addEventListener('click', newScript);
  els.btnImport.addEventListener('click', importScript);
  els.btnLibrary.addEventListener('click', () => {
    els.libraryPanel.hidden = !els.libraryPanel.hidden;
    if (!els.libraryPanel.hidden) setLibraryTab(settings.libraryTab === 'sessions' ? 'sessions' : 'library');
  });
  els.btnSettings.addEventListener('click', () => {
    if (els.settingsModal.hidden) openSettings();
    else closeSettings();
  });
  els.btnCloseSettings.addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });

  document.addEventListener('keydown', (e) => {
    const view = document.body.dataset.view;
    if (view === 'present') {
      P.handleKey(e);
      return;
    }
    if (view === 'remote') {
      handleRemoteKeys(e);
      return;
    }
    if (e.key === 'Escape') {
      closeSettings();
      closeRemoteModal();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (dirty && current) {
      lab.scripts.saveNow({ id: current.id, title: current.title, body: current.body });
    }
  });

  lab.onMenu((action) => {
    if (P.active || rc.mode) return;
    if (action === 'new') newScript();
    else if (action === 'import') importScript();
    else if (action === 'save') {
      flushSave();
      doSave();
    } else if (action === 'duplicate') duplicateScript();
    else if (action === 'settings') {
      if (els.settingsModal.hidden) openSettings();
      else closeSettings();
    } else if (action === 'present') enterPresent();
  });

  lab.shuttle.onEvent(handleShuttle);
  lab.shuttle.onStatus(renderShuttleStatus);
  lab.onRemote(handleRemote);
  lab.onLiveEdit(applyLiveEdit);
  lab.voice.onEvent(handleVoiceEvent);
  els.btnVoiceToggle.addEventListener('click', toggleVoiceListening);

  els.btnRemote.addEventListener('click', () => {
    if (els.remoteModal.hidden) openRemoteModal();
    else closeRemoteModal();
  });
  els.btnCloseRemote.addEventListener('click', closeRemoteModal);
  els.remoteModal.addEventListener('click', (e) => {
    if (e.target === els.remoteModal) closeRemoteModal();
  });
  els.btnRemoteConnectManual.addEventListener('click', () => {
    const host = els.remoteHost.value.trim();
    if (host) connectRemote(host);
  });
  els.remoteHost.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnRemoteConnectManual.click();
  });
  els.btnRemoteDisconnect.addEventListener('click', disconnectRemote);
  els.btnRemoteEdit.addEventListener('click', () => toggleRemoteEditPane());
  els.remoteEditor.addEventListener('input', () => {
    clearTimeout(remoteEditTimer);
    remoteEditTimer = setTimeout(flushRemoteEdit, 250);
  });
  els.remoteEditor.addEventListener('blur', flushRemoteEdit);
  els.btnRemotePresent.addEventListener('click', () => {
    const presenting = rc.state && rc.state.presenting;
    lab.remote.send({ t: 'cmd', action: presenting ? 'exitPresent' : 'enterPresent' });
  });

  lab.remote.onServices((list) => {
    if (!els.remoteModal.hidden) renderRemoteList(list);
  });
  lab.remote.onStatus((status) => {
    if (status.connected) {
      if (P.active) {
        // A stale auto-reconnect must never hijack a machine that is
        // presenting locally; drop the link and forget the host.
        lab.remote.disconnect();
        return;
      }
      enterRemoteView(status);
      return;
    }
    if (status.reconnecting && rc.mode) {
      // Connection lost mid-session: hold the view, main keeps retrying.
      rc.state = null;
      applyRemoteState();
      els.remoteTarget.classList.add('lost');
      els.remoteBadge.textContent = 'connection lost';
      els.remoteOverlay.textContent = `Connection lost — reconnecting to ${status.targetName}…`;
      return;
    }
    if (rc.mode) exitRemoteView();
    els.remoteModalStatus.textContent = status.reconnecting
      ? `Reconnecting to ${status.targetName}…`
      : status.error
        ? `Connection failed: ${status.error}`
        : '';
    if (!status.reconnecting) {
      rc.doc = null;
      rc.state = null;
    }
  });
  lab.remote.onDoc((doc) => {
    rc.doc = doc;
    if (rc.mode) applyRemoteDoc();
  });
  lab.remote.onState((state) => {
    rc.state = state;
    rc.stateAt = performance.now();
    if (rc.mode) applyRemoteState();
  });
  window.addEventListener('resize', () => {
    if (rc.mode) rescaleRemote();
  });

  window.addEventListener('error', (e) => lab.reportError(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => lab.reportError('unhandled rejection: ' + String(e.reason)));
}

// ---------- Boot ----------

async function init() {
  if (lab.platform === 'darwin') document.body.classList.add('mac');
  settings = await lab.settings.get();
  applyPromptVars();
  syncSettingsUI();
  wireSettings();
  wireStudio();
  wireEvents();

  let script = settings.lastScriptId ? await lab.scripts.get(settings.lastScriptId) : null;
  if (!script) {
    const list = await lab.scripts.list();
    if (list.length) {
      script = await lab.scripts.get(list[0].id);
    }
  }
  if (!script) {
    script = await lab.scripts.create({ title: 'Welcome to LabPrompter', body: STARTER_BODY });
  }
  openScript(script);
  setSaveState('');

  renderShuttleStatus(await lab.shuttle.status());
  pushState();
  lab.ready();
}

init().catch((err) => {
  lab.reportError('init failed: ' + (err && err.stack ? err.stack : err));
});
