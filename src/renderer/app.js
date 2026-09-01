import { renderChunks, buildBackdropHTML, countWords, fmtDuration, fmtTime, measureLines } from './render.js';
import { Prompter, JOG_BASE_PX } from './present.js';

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
  scriptBody: $('scriptBody'),
  backdropContent: $('backdropContent'),
  btnInsertBreak: $('btnInsertBreak'),
  stats: $('stats'),
  previewContent: $('previewContent'),
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

// Client-side state when this instance is controlling another one.
const rc = { mode: false, doc: null, state: null, stateAt: 0, raf: null };

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
  els.presentView.classList.toggle('no-progress', !settings.showProgress);
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
  $('setDisplayMode').value = settings.displayMode === 'extended' ? 'extended' : 'mirrored';
  $('setAutoMove').checked = settings.autoMoveDisplay;
  $('setAllowRemote').checked = settings.allowRemote;
  $('capsToggle').checked = settings.allCaps;
  syncDisplayModeUI();
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
  if (!els.libraryPanel.hidden) refreshLibrary();
}

function flushSave() {
  clearTimeout(saveTimer);
  if (dirty && current) {
    dirty = false;
    lab.scripts.saveNow({ id: current.id, title: current.title, body: current.body });
    setSaveState('Saved ' + fmtTime(Date.now()));
  }
}

function openScript(script) {
  flushSave();
  current = script;
  els.scriptTitle.value = script.title;
  els.scriptBody.value = script.body;
  els.scriptBody.scrollTop = 0;
  refreshEditorViews();
  settings.lastScriptId = script.id;
  persistSettings();
  pushDoc();
  if (!els.libraryPanel.hidden) refreshLibrary();
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
    const meta = document.createElement('div');
    meta.className = 'script-meta';
    meta.textContent = `${item.words} words · ${fmtTime(item.updatedAt)}`;
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

// ---------- Present mode ----------

async function enterPresent() {
  if (P.active) return;
  flushSave();
  closeSettings();
  renderChunks(els.scriptBody.value, els.promptContent);
  applyPromptVars();
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
  });
  clearInterval(stateTimer);
  stateTimer = setInterval(pushState, 100);
}

function exitPresent() {
  if (!P.active) return;
  clearInterval(stateTimer);
  stateTimer = null;
  P.exit();
  document.body.dataset.view = 'editor';
  lab.present.exit();
  pushState();
  els.scriptBody.focus();
}

// ---------- Live editing while presenting ----------

// A body edit arriving from the Operator View: update the script exactly as
// if it were typed in the editor, and if Present Mode is up, reflow the
// prompter in place without disturbing the talent's reading position.
function applyLiveEdit(newBody) {
  if (!current || typeof newBody !== 'string') return;
  const oldBody = current.body;
  if (newBody === oldBody) return;
  if (P.active) reflowPresent(oldBody, newBody);
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
    markDirty();
  });

  els.btnInsertBreak.addEventListener('click', insertBreak);
  els.btnPresent.addEventListener('click', enterPresent);
  els.btnNew.addEventListener('click', newScript);
  els.btnImport.addEventListener('click', importScript);
  els.btnLibrary.addEventListener('click', () => {
    els.libraryPanel.hidden = !els.libraryPanel.hidden;
    if (!els.libraryPanel.hidden) refreshLibrary();
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
    if (P.active) return;
    if (action === 'new') newScript();
    else if (action === 'import') importScript();
    else if (action === 'save') {
      flushSave();
      doSave();
    } else if (action === 'present') enterPresent();
  });

  lab.shuttle.onEvent(handleShuttle);
  lab.shuttle.onStatus(renderShuttleStatus);
  lab.onRemote(handleRemote);
  lab.onLiveEdit(applyLiveEdit);

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
