// Runs inside the make-icons Electron window (nodeIntegration on).
// Draws the LabPrompter icon at every needed size and writes the PNGs.
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

const ROOT = path.join(__dirname, '..');
const SD_IMGS = path.join(ROOT, 'streamdeck', 'com.labprompter.streamdeck.sdPlugin', 'imgs');

const AMBER = '#f0b429';

const OUTPUTS = [
  { file: 'build/icon.iconset/icon_16x16.png', size: 16, style: 'app' },
  { file: 'build/icon.iconset/icon_16x16@2x.png', size: 32, style: 'app' },
  { file: 'build/icon.iconset/icon_32x32.png', size: 32, style: 'app' },
  { file: 'build/icon.iconset/icon_32x32@2x.png', size: 64, style: 'app' },
  { file: 'build/icon.iconset/icon_128x128.png', size: 128, style: 'app' },
  { file: 'build/icon.iconset/icon_128x128@2x.png', size: 256, style: 'app' },
  { file: 'build/icon.iconset/icon_256x256.png', size: 256, style: 'app' },
  { file: 'build/icon.iconset/icon_256x256@2x.png', size: 512, style: 'app' },
  { file: 'build/icon.iconset/icon_512x512.png', size: 512, style: 'app' },
  { file: 'build/icon.iconset/icon_512x512@2x.png', size: 1024, style: 'app' },
  { file: 'src/assets/icon.png', size: 512, style: 'app' },
  { file: path.join(SD_IMGS, 'keyIcon.png'), size: 72, style: 'key' },
  { file: path.join(SD_IMGS, 'keyIcon@2x.png'), size: 144, style: 'key' },
  { file: path.join(SD_IMGS, 'actionIcon.png'), size: 20, style: 'glyph' },
  { file: path.join(SD_IMGS, 'actionIcon@2x.png'), size: 40, style: 'glyph' },
  { file: path.join(SD_IMGS, 'pluginIcon.png'), size: 28, style: 'glyph' },
  { file: path.join(SD_IMGS, 'pluginIcon@2x.png'), size: 56, style: 'glyph' },
];

function bar(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
}

function readingLine(ctx, x, y, w, thickness, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - thickness / 2, w, thickness);
  const a = thickness * 3.2;
  ctx.beginPath();
  ctx.moveTo(x - a * 1.15, y - a / 2);
  ctx.lineTo(x - a * 0.15, y);
  ctx.lineTo(x - a * 1.15, y + a / 2);
  ctx.closePath();
  ctx.fill();
}

// Shared motif: text bars scrolling past an amber reading line.
function drawMotif(ctx, x, y, w, lineFrac, small) {
  const lineY = y + w * lineFrac;
  const barH = w * 0.075;
  const gap = w * 0.155;
  const bx = x + w * 0.16;
  const bw = w * 0.68;
  if (!small) bar(ctx, bx, lineY - gap - barH / 2, bw * 0.55, barH, 'rgba(255,255,255,0.22)');
  bar(ctx, bx, lineY + gap * 0.45, bw, barH, 'rgba(255,255,255,0.96)');
  bar(ctx, bx, lineY + gap * 0.45 + gap, bw * 0.8, barH, 'rgba(255,255,255,0.55)');
  if (!small) bar(ctx, bx, lineY + gap * 0.45 + gap * 2, bw * 0.55, barH, 'rgba(255,255,255,0.3)');
  readingLine(ctx, bx, lineY, bw, Math.max(1.5, w * 0.035), AMBER);
}

function drawApp(ctx, s) {
  const m = s * 0.09;
  const w = s - 2 * m;
  ctx.beginPath();
  ctx.roundRect(m, m, w, w, w * 0.225);
  const g = ctx.createLinearGradient(0, m, 0, m + w);
  g.addColorStop(0, '#242932');
  g.addColorStop(1, '#0c0e11');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.008);
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.stroke();
  drawMotif(ctx, m, m, w, 0.36, s <= 32);
}

function drawKey(ctx, s) {
  ctx.fillStyle = '#16181d';
  ctx.fillRect(0, 0, s, s);
  drawMotif(ctx, s * 0.06, s * 0.03, s * 0.88, 0.36, false);
}

function drawGlyph(ctx, s) {
  const w = s * 0.96;
  const x = s * 0.02;
  const lineY = s * 0.4;
  const barH = w * 0.11;
  const gap = w * 0.22;
  const bx = x + w * 0.2;
  const bw = w * 0.68;
  bar(ctx, bx, lineY - gap - barH / 2, bw * 0.6, barH, 'rgba(216,216,216,0.4)');
  bar(ctx, bx, lineY + gap * 0.4, bw, barH, 'rgba(216,216,216,0.95)');
  bar(ctx, bx, lineY + gap * 0.4 + gap, bw * 0.75, barH, 'rgba(216,216,216,0.6)');
  readingLine(ctx, bx, lineY, bw, Math.max(1.5, w * 0.06), '#d8d8d8');
}

try {
  const canvas = document.getElementById('c');
  let written = 0;
  for (const out of OUTPUTS) {
    canvas.width = out.size;
    canvas.height = out.size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, out.size, out.size);
    if (out.style === 'app') drawApp(ctx, out.size);
    else if (out.style === 'key') drawKey(ctx, out.size);
    else drawGlyph(ctx, out.size);
    const data = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    const file = path.isAbsolute(out.file) ? out.file : path.join(ROOT, out.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    written++;
  }
  ipcRenderer.send('icons-done', written);
} catch (err) {
  ipcRenderer.send('icons-error', String((err && err.stack) || err));
}
