import { renderChunks, buildBackdropHTML, countWords, fmtDuration, fmtTime } from './render.js';
import { Prompter } from './present.js';

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
  readingLine: $('readingLine'),
  pauseBadge: $('pauseBadge'),
  progressFill: $('progressFill'),
  settingsModal: $('settingsModal'),
  btnCloseSettings: $('btnCloseSettings'),
  buttonRows: $('buttonRows'),
};

let settings = null;
let current = null;
let dirty = false;
let saveTimer = null;
let previewTimer = null;
let settingsTimer = null;

const P = new Prompter(els, () => settings, {
  onExit: () => exitPresent(),
  adjustBaseSpeed: (d) => {
    settings.baseSpeed = Math.min(400, Math.max(10, settings.baseSpeed + d));
    persistSettings();
  },
  adjustFontSize: (d) => adjustFontSize(d),
  toggleCaps: () => setAllCaps(!settings.allCaps),
});

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
  settingsTimer = setTimeout(() => lab.settings.set(settings), 400);
}

const SETTING_CONTROLS = [
  { id: 'fontSize', key: 'fontSize', out: 'fontSizeVal', fmt: (v) => v + 'px' },
  { id: 'setLineHeight', key: 'lineHeight', fmt: (v) => Number(v).toFixed(2) },
  { id: 'setTextWidth', key: 'textWidthPct', fmt: (v) => v + '%' },
  { id: 'setLinePct', key: 'readingLinePct', fmt: (v) => v + '%' },
  { id: 'setBaseSpeed', key: 'baseSpeed', fmt: (v) => v + ' px/s' },
  { id: 'setMaxShuttle', key: 'maxShuttleSpeed', fmt: (v) => v + ' px/s' },
  { id: 'setJogStep', key: 'jogStep', fmt: (v) => v + ' px' },
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
  $('setAutoMove').checked = settings.autoMoveDisplay;
  $('capsToggle').checked = settings.allCaps;
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
  $('setAutoMove').addEventListener('change', (e) => {
    settings.autoMoveDisplay = e.target.checked;
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
  renderChunks(els.scriptBody.value, els.promptContent);
  applyPromptVars();
  document.body.dataset.view = 'present';
  try {
    await lab.present.enter();
  } catch {
    // present anyway in the current window
  }
  requestAnimationFrame(() => P.enter());
}

function exitPresent() {
  if (!P.active) return;
  P.exit();
  document.body.dataset.view = 'editor';
  lab.present.exit();
  els.scriptBody.focus();
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
  if (ev.type === 'shuttle') {
    P.setShuttle(ev.value);
  } else if (ev.type === 'jog') {
    if (P.active) P.scrub(ev.delta * settings.jogStep);
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
    if (document.body.dataset.view === 'present') {
      P.handleKey(e);
      return;
    }
    if (e.key === 'Escape') closeSettings();
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
  lab.ready();
}

init().catch((err) => {
  lab.reportError('init failed: ' + (err && err.stack ? err.stack : err));
});
