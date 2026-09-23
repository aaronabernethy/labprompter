// Builds the voice-follow native helper (native/speech-helper, see
// docs/voice-follow.md) and stages it at native/speech-helper/dist/ —
// the one path both `npm start` (src/main/voice.js) and the
// electron-builder config (package.json → build.mac.extraResources) read
// from. Packaging must never fail just because this optional, macOS-only
// feature couldn't be compiled here, so anywhere else (Linux/Windows dev,
// no Swift toolchain) gets a stub that reports itself as unavailable
// instead of a missing file.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG_DIR = path.join(ROOT, 'native', 'speech-helper');
const OUT_DIR = path.join(PKG_DIR, 'dist');
const OUT_BIN = path.join(OUT_DIR, 'speech-helper');

const STUB = `#!/bin/sh
echo '{"type":"error","message":"Voice-follow helper was not compiled into this build."}'
exit 1
`;

function writeStub(reason) {
  console.log(`[build-speech-helper] ${reason} — bundling a stub instead.`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_BIN, STUB);
  fs.chmodSync(OUT_BIN, 0o755);
}

if (process.platform !== 'darwin') {
  writeStub('not running on macOS');
} else {
  try {
    execFileSync('swift', ['build', '--package-path', PKG_DIR, '-c', 'release'], { stdio: 'inherit' });
    const built = path.join(PKG_DIR, '.build', 'release', 'speech-helper');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.copyFileSync(built, OUT_BIN);
    fs.chmodSync(OUT_BIN, 0o755);
    console.log('[build-speech-helper] built', OUT_BIN);
  } catch (err) {
    writeStub('swift build failed or unavailable (' + err.message + ')');
  }
}
