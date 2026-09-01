// Operator View for Extended display mode. Renders the same doc/state feed
// the network remote-control mirror consumes, but delivered over IPC from the
// main process — no socket involved, both windows live in one app. Adds the
// operator-only extras the talent screen never shows: upcoming lines, section
// position, live speed, and controller status.

import { renderChunks, measureLines, applyLineVars } from './render.js';

const lab = window.lab;
const $ = (id) => document.getElementById(id);
const els = {
  badge: $('opBadge'),
  speed: $('opSpeed'),
  btnExit: $('btnOpExit'),
  stage: $('opStage'),
  screen: $('opScreen'),
  content: $('opContent'),
  line: $('opLine'),
  progressFill: $('opProgressFill'),
  overlay: $('opOverlay'),
  section: $('opSection'),
  nextSection: $('opNextSection'),
  progressText: $('opProgressText'),
  upcoming: $('opUpcoming'),
  shuttle: $('opShuttle'),
  measure: $('opMeasure'),
  btnEdit: $('btnOpEdit'),
  editPane: $('opEditPane'),
  editor: $('opEditor'),
};

// 100% speed = 600 px/s (see present.js FULL_SPEED_PX); ÷6 turns px/s into %.
const PX_PER_PCT = 6;

const op = { doc: null, state: null, stateAt: 0, lines: [], sections: [], lastPanelAt: 0 };

// ---------- Doc (script + display settings from the presenting window) ----------

function applyDoc() {
  const d = op.doc;
  if (!d) return;
  const s = d.s;
  const r = document.documentElement.style;
  r.setProperty('--pfs', s.fontSize + 'px');
  r.setProperty('--plh', s.lineHeight);
  r.setProperty('--ptw', s.textWidthPct + '%');
  document.body.classList.toggle('op-caps', !!s.allCaps);
  els.screen.style.width = d.vw + 'px';
  els.screen.style.height = d.vh + 'px';
  els.screen.classList.toggle('no-progress', !s.showProgress);
  els.measure.style.width = d.vw + 'px';
  els.line.style.top = s.readingLinePct + '%';
  applyLineVars(els.line, s);
  renderChunks(d.body, els.content);
  op.lines = measureLines(d.body, els.measure);
  collectGeometry();
  syncEditor();
  rescale();
  op.lastPanelAt = 0;
}

function snippet(text) {
  const words = (text || '').trim().split(/\s+/).slice(0, 7).join(' ');
  return words.length > 60 ? words.slice(0, 60) + '…' : words;
}

function collectGeometry() {
  op.sections = [...els.content.querySelectorAll('.jump')].map((el) => ({
    top: el.offsetTop,
    snippet: snippet(el.textContent),
  }));
}

function rescale() {
  const d = op.doc;
  if (!d) return;
  const sw = els.stage.clientWidth;
  const sh = els.stage.clientHeight;
  const k = Math.min(sw / d.vw, sh / d.vh) || 1;
  els.screen.style.transform = `scale(${k})`;
  els.screen.style.left = Math.max(0, (sw - d.vw * k) / 2) + 'px';
  els.screen.style.top = Math.max(0, (sh - d.vh * k) / 2) + 'px';
}

// ---------- State (10Hz packets from the presenting window) ----------

function applyState() {
  const st = op.state;
  const presenting = !!(st && st.presenting);
  els.overlay.classList.toggle('gone', presenting);
  els.badge.textContent = !st ? '' : presenting ? (st.playing ? '▶ rolling' : '❚❚ paused') : 'in editor';
  let speedTxt = '';
  if (st && st.baseSpeedPct != null) speedTxt = `base ${st.baseSpeedPct}%`;
  if (presenting && st.speed) {
    speedTxt += ` · ${st.speed < 0 ? '↑' : '↓'} ${Math.round(Math.abs(st.speed) / PX_PER_PCT)}%`;
  }
  els.speed.textContent = speedTxt;
}

// Extrapolate between state packets so the mirror scrolls smoothly.
function currentPos() {
  const st = op.state;
  const dt = (performance.now() - op.stateAt) / 1000;
  const pos = (st.pos || 0) + (st.speed || 0) * Math.min(dt, 1);
  return Math.max(0, Math.min(st.max || 0, pos));
}

function draw() {
  const d = op.doc;
  const st = op.state;
  if (!d || !st || !st.presenting) return;
  const pos = currentPos();
  const lineY = d.vh * (d.s.readingLinePct / 100);
  els.content.style.transform = `translate3d(0, ${(lineY - pos).toFixed(2)}px, 0)`;
  els.progressFill.style.width = (st.max ? (pos / st.max) * 100 : 0) + '%';
  const now = performance.now();
  if (now - op.lastPanelAt > 150) {
    op.lastPanelAt = now;
    updatePanel(pos, st);
  }
}

function updatePanel(pos, st) {
  const secs = op.sections;
  if (!secs.length) {
    els.section.textContent = '—';
    els.nextSection.textContent = '';
  } else {
    let cur = 0;
    for (let i = 0; i < secs.length; i++) if (secs[i].top <= pos + 4) cur = i;
    els.section.textContent = `Section ${cur + 1} of ${secs.length} — “${secs[cur].snippet}”`;
    const nxt = secs[cur + 1];
    els.nextSection.textContent = nxt ? `Next: “${nxt.snippet}”` : 'Last section';
  }
  els.progressText.textContent = st.max ? Math.round((pos / st.max) * 100) + '% through script' : '';

  const lines = op.lines;
  els.upcoming.innerHTML = '';
  if (!lines.length) return;
  let li = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].top <= pos + 2) li = i;
  while (li > 0 && !lines[li].text.trim()) li--;
  const add = (text, cls) => {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    els.upcoming.appendChild(div);
  };
  add(lines[li].text || ' ', 'up-current');
  let shown = 0;
  for (let i = li + 1; i < lines.length && shown < 5; i++) {
    if (!lines[i].text.trim()) continue;
    add(lines[i].text, 'up-line');
    shown++;
  }
}

// ---------- Live editing (changes flow to the presenting window) ----------

let editTimer = null;

function toggleEditPane(show) {
  const on = show != null ? show : els.editPane.hidden;
  els.editPane.hidden = !on;
  els.btnEdit.classList.toggle('primary', on);
  if (on) {
    syncEditor();
    els.editor.focus();
  }
  requestAnimationFrame(rescale);
}

// Keep the textarea in step with the script, but never yank it out from
// under the operator's cursor: while it has focus, it IS the source.
function syncEditor() {
  if (!op.doc) return;
  if (document.activeElement === els.editor) return;
  if (els.editor.value !== op.doc.body) els.editor.value = op.doc.body;
}

function flushEdit() {
  clearTimeout(editTimer);
  editTimer = null;
  if (op.doc && els.editor.value !== op.doc.body) lab.operator.edit(els.editor.value);
}

// ---------- Controls (same keys as Present Mode, routed to the main window) ----------

function handleKeys(e) {
  if (e.target === els.editor) {
    if (e.key === 'Escape') {
      flushEdit();
      els.editor.blur();
      toggleEditPane(false);
      e.preventDefault();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const send = (action) => lab.operator.cmd(action);
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
      toggleEditPane();
      break;
    case 'Escape':
      send('exitPresent');
      break;
    default:
      return;
  }
  e.preventDefault();
}

function renderShuttleStatus(st) {
  const el = els.shuttle;
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

// ---------- Boot ----------

function init() {
  if (lab.platform === 'darwin') document.body.classList.add('mac');

  lab.operator.onDoc((d) => {
    op.doc = d;
    applyDoc();
  });
  lab.operator.onState((s) => {
    op.state = s;
    op.stateAt = performance.now();
    applyState();
  });
  lab.shuttle.onStatus(renderShuttleStatus);
  lab.shuttle.status().then(renderShuttleStatus);

  els.btnExit.addEventListener('click', () => lab.operator.cmd('exitPresent'));
  els.btnEdit.addEventListener('click', () => toggleEditPane());
  els.editor.addEventListener('input', () => {
    clearTimeout(editTimer);
    editTimer = setTimeout(flushEdit, 250);
  });
  els.editor.addEventListener('blur', flushEdit);
  document.addEventListener('keydown', handleKeys);
  window.addEventListener('resize', rescale);
  window.addEventListener('error', (e) => lab.reportError(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => lab.reportError('unhandled rejection: ' + String(e.reason)));

  const tick = () => {
    draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  lab.operator.ready();
}

init();
