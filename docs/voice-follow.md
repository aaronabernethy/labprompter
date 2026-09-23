# Voice-follow (beta)

Voice-follow lets the talent's own voice drive the scroll instead of a fixed
speed: speak naturally — pause, ad-lib, skip a line — and the prompter keeps
your next word roughly where you left it. It's off by default (Settings →
Speed → **Enable voice-follow**), macOS-only, and everything happens
on-device: no audio or transcript ever leaves the Mac.

This is a first cut. The pieces are all real and wired together end to end,
but the native half (`native/speech-helper/`) was written and reviewed
without a Mac to compile or run it on — see **Known risk areas** below
before shipping it to the studio Mac.

## Architecture

```
Present Mode (renderer)                Main process              native/speech-helper
──────────────────────                 ─────────────              ────────────────────
btnVoiceToggle click
  → lab.voice.start()  ───────────────→ voice.js spawns the   ──→  swift binary:
                                         helper binary              SFSpeechRecognizer
                                                                     + AVAudioEngine,
lab.voice.onEvent(ev)  ←──────────────  forwards each JSON    ←──   requiresOnDeviceRecognition
  → VoiceFollowMatcher.feed(ev.text)    line as 'voice:event'       = true (hard-set)
  → P.setVoiceTarget(px)
```

- **`native/speech-helper/`** — a small Swift Package Manager executable.
  Electron/Node can't call Apple's Speech framework directly, so this
  process does the actual listening. It authorizes speech + microphone
  access, runs `SFSpeechRecognizer` with `requiresOnDeviceRecognition =
  true`, and prints line-delimited JSON to stdout: `{"type":"ready"}`,
  `{"type":"partial"|"final","text":"..."}`, `{"type":"permission-denied",
  "stage":"speech"|"microphone"}`, `{"type":"error","message":"..."}`.
  A `"stop"` line on stdin shuts it down. On-device recognition tasks cap
  out around a minute of audio, so it rolls over to a fresh request every
  50s without dropping the audio tap.
- **`src/main/voice.js`** — spawns the helper (mirrors the existing
  `src/main/shuttle.js` pattern for the Contour shuttle: a small wrapper
  around an external device/process, with `start`/`stop`/`status`).
  Resolves the binary at `native/speech-helper/dist/speech-helper` in dev
  or `process.resourcesPath/speech-helper` when packaged. Missing binary,
  non-macOS, or a spawn failure all degrade to `{ ok: false, error }`
  rather than throwing.
- **`src/renderer/voice-follow.js`** — pure word-matching logic, no DOM.
  `buildWordIndex(lines)` takes the same line geometry `measureLines()`
  (in `render.js`) already produces for live-edit reflow, and flattens it
  into one entry per spoken word (screen directions excluded, same as the
  word count). `VoiceFollowMatcher.feed(text)` searches a 40-word lookahead
  window ahead of the current position for each recognized word, so an
  ad-lib or a skipped line doesn't derail it, and returns a target scroll
  position.
- **`src/renderer/present.js`** (`Prompter` class) — a new `voiceTarget`
  drive mode alongside shuttle/hold/play: `speed()` returns a value
  proportional to `voiceTarget - pos` (clamped), so the scroll eases
  toward the last recognized word rather than snapping. `setVoiceTarget`
  takes priority over manual controls while it's set.
- **`src/renderer/app.js`** — wires the mic toggle button in Present Mode,
  builds/rebuilds the matcher (on entering Present Mode and after a live
  edit, preserving read-through progress proportionally), and turns
  `voice:event`s into matcher feeds / status text / `P.setVoiceTarget`
  calls.

## Building the helper

```
npm run build:helper
```

Compiles `native/speech-helper` with Swift Package Manager and stages the
binary at `native/speech-helper/dist/speech-helper` — the path both
`npm start` and the packaged app (via `electron-builder`'s
`build.mac.extraResources`) read from. `npm run dist` / `npm run release`
run this first automatically (see `tools/build-speech-helper.js`).

Off macOS, or if `swift build` fails, it stages a stub script instead of
failing the build — the stub reports itself as unavailable
(`{"type":"error","message":"Voice-follow helper was not compiled into this
build."}`) rather than leaving the app unable to package at all. That's
also what a normal `git clone` + `npm run dist` gets today on this Linux
dev environment, since there's no way to build or test Swift/Speech-
framework code without a real Mac.

## Known risk areas (please check these on the studio Mac)

1. **TCC permission attribution.** `native/speech-helper` is a bare
   command-line binary, not a `.app` bundle — the microphone/speech
   recognition permission prompt (and the usage-description strings that
   have to back it) is normally attributed to whichever process macOS
   considers "responsible" for it. `package.json`'s
   `build.mac.extendInfo` adds `NSMicrophoneUsageDescription` /
   `NSSpeechRecognitionUsageDescription` to **LabPrompter.app**'s own
   Info.plist on the assumption that a plain executable spawned by a
   signed, bundled app inherits that app's TCC identity. If the
   permission prompt doesn't appear, or System Settings shows the request
   under some other name, this is the area to dig into — the usual fix
   is embedding a matching `Info.plist` directly into the helper binary's
   `__TEXT,__info_plist` section (a documented technique for CLI tools
   that need their own TCC prompt), or turning the helper into a proper
   `.app`/XPC bundle instead of a loose binary under Resources.
2. **Never compiled.** The Swift code hasn't been run through `swiftc`/
   `swift build` anywhere — this sandbox has no Swift toolchain. It
   should build against modern Swift/Xcode, but a first CI run or local
   `npm run build:helper` on a Mac is the first real compile, and small
   fixes (a signature mismatch, an availability annotation) wouldn't be
   surprising.
3. **Entitlements.** `build/entitlements.mac.plist` wasn't changed —
   LabPrompter isn't sandboxed, so the App Sandbox microphone/speech
   entitlement keys wouldn't do anything here even if added. If the app
   ever moves to the Mac App Store (sandboxed), `com.apple.security.
   device.audio-input` and `com.apple.security.personal-information.
   speech-recognition` would need adding then.
4. **Notarization.** The helper binary needs to be signed for a notarized
   release to pass Gatekeeper on other Macs — electron-builder should
   sign everything under `Contents/Resources` as part of the existing
   `hardenedRuntime` + `CSC_LINK` flow, but this hasn't been verified
   against a real signing identity.
5. **Word-matching is line-granularity, not karaoke-precise.** Matched
   words map to a position spread evenly across their source line rather
   than an exact per-character offset, which is plenty for smooth
   scrolling but means a future per-word highlight would want finer
   geometry than `measureLines()` currently returns.

None of this blocks trying it — worst case on first boot is "doesn't
listen yet" with a clear error message, not a crash — but budget a short
pass on a real Mac before treating voice-follow as done.
