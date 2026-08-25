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
