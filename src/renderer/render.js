export const MARKER_RE = /^\s*(?:-{3,}|\[break\])\s*$/i;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Splits the script into chunks separated by marker lines and renders them
// into `container`. Chunks carry .jump so the prompter can collect targets.
export function renderChunks(body, container) {
  container.innerHTML = '';
  const text = (body || '').replace(/\r\n?/g, '\n');
  container.classList.toggle('empty', !text.trim());
  if (!text.trim()) return;

  const lines = text.split('\n');
  let buf = [];

  const flushChunk = () => {
    const chunkText = buf.join('\n').replace(/^\n+|\n+$/g, '');
    buf = [];
    if (!chunkText) return;
    const div = document.createElement('div');
    div.className = 'chunk jump';
    div.textContent = chunkText;
    container.appendChild(div);
  };

  for (const line of lines) {
    if (MARKER_RE.test(line)) {
      flushChunk();
      const gap = document.createElement('div');
      gap.className = 'break-gap';
      container.appendChild(gap);
    } else {
      buf.push(line);
    }
  }
  flushChunk();
}

// Lays `body` out one source line per element inside `container`, mirroring
// renderChunks geometry exactly (same chunk/break structure, trimming, and
// widths), so a pixel scroll position can be mapped back to a script line.
// Returns [{ top, line, text }] where `line` is the raw source line index.
export function measureLines(body, container) {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'prompt-text';
  container.appendChild(root);
  const text = (body || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];

  let buf = [];
  const flush = () => {
    const lines = buf;
    buf = [];
    while (lines.length && lines[0].text === '') lines.shift();
    while (lines.length && lines[lines.length - 1].text === '') lines.pop();
    if (!lines.length) return;
    const chunk = document.createElement('div');
    chunk.className = 'chunk';
    for (const l of lines) {
      const p = document.createElement('div');
      p.className = 'pline';
      p.textContent = l.text;
      p.dataset.line = l.line;
      chunk.appendChild(p);
    }
    root.appendChild(chunk);
  };

  const raw = text.split('\n');
  for (let i = 0; i < raw.length; i++) {
    if (MARKER_RE.test(raw[i])) {
      flush();
      const gap = document.createElement('div');
      gap.className = 'break-gap';
      root.appendChild(gap);
    } else {
      buf.push({ text: raw[i], line: i });
    }
  }
  flush();

  return [...container.querySelectorAll('.pline')].map((el) => ({
    top: el.offsetTop,
    line: Number(el.dataset.line),
    text: el.textContent,
  }));
}

export function buildBackdropHTML(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (MARKER_RE.test(line) && line.trim() ? `<span class="mk">${escapeHtml(line)}</span>` : escapeHtml(line)))
    .join('\n');
}

export function countWords(text) {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
