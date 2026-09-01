# LabPrompter

A local-only teleprompter app for macOS, built for the **Elgato Prompter XL** and driven by a **Contour ShuttleXpress** jog/shuttle controller. No server, no cloud, no accounts — everything lives on the studio Mac.

## Why this exists

Elgato's Camera Hub can scroll a script on the Prompter XL, but it gives the operator **no way to see the current scroll position** from the operator's seat. You're flying blind: you can't tell which line the talent is reading, so you can't pace the scroll or recover cleanly when they go off script.

LabPrompter fixes that with a simple trick: the present view carries a thin **reading line** marking the current position, and because the operator's second display is *mirrored* onto the Prompter XL, the operator and the talent see exactly the same thing. The operator always knows where the read is — and drives the speed in real time with a shuttle controller.

## How the studio is set up

1. The Mac has two screens: **Screen 1** (normal desktop, where you edit) and **Screen 2**.
2. **Screen 2 is mirrored onto the Prompter XL** — System Settings → Displays → select the Prompter, set it to *Mirror* Screen 2. (The Prompter XL hardware flips the image for the talent's glass, so LabPrompter renders normally — no software mirroring needed.)
3. Edit your script on Screen 1, then hit **Present**. LabPrompter moves itself fullscreen onto the secondary display automatically (toggleable in Settings). Present Mode contains nothing operator-only, so it's always safe for the talent to see.
4. Plug in the Contour ShuttleXpress. No Contour driver needed — LabPrompter reads the device directly over USB HID. **If you have Contour's own driver app installed, quit it**, otherwise its keystroke mappings will fire on top of LabPrompter's.

This mirrored arrangement is the default (**Settings → Displays → Display mode → Mirrored**).

## Extended Display Setup

If you'd rather keep Screen 2 as a real, separate display — System Settings → Displays → select the Prompter, set it to **Extend** (not Mirror) — switch **Settings → Displays → Display mode** to **Extended**. Now the talent's screen and the operator's screen are genuinely different, so the operator view can show more than the talent ever sees.

Hitting **Present** in Extended mode opens two windows:

- **Present window** — exactly the same talent-safe Present Mode as always (fullscreen, black, white text, reading line, no chrome), placed on the display connected to the Prompter XL.
- **Operator View window** — stays on Screen 1, where the editor was. It shows a scaled live mirror of the prompter (reading line, progress bar, play state — the same rendering the network remote control uses, driven directly from local state instead of over the LAN), plus operator-only extras: the next few upcoming lines greyed out, your current section and the next one, a live speed readout, and the controller connection status.

The Operator View accepts **all the same keyboard controls as Present Mode** (Space, arrows, PgUp/PgDn, and so on — Esc exits), and the shuttle controller works no matter which window has focus — you never need to look at the second screen. Closing the Operator View window also exits Present Mode.

### Live editing while presenting

Press **E** (or the **Edit script** button) in the Operator View to open a live-edit pane. Changes appear on the teleprompter as you type — no need to exit Present Mode — and autosave to the script library as usual. The prompter holds its place: an edit below the reading line changes nothing the talent is looking at, and an edit above it shifts the scroll by exactly the changed height, so the line under the reading line never jumps. Adding or removing `---` markers updates the jump targets and section list immediately. While the edit pane has focus your keyboard types into the script (Esc closes the pane; prompter keys work again once it's closed).

The same edit pane exists in the **Remote Control** view (see below), so an assistant on a second Mac can fix the script live too.

Differences from Mirrored mode at a glance: in Mirrored mode the operator watches the exact talent feed (nothing operator-only can appear, since the talent sees the same pixels); in Extended mode the operator gets the richer Operator View while the talent still gets the plain Present window. The *Present on secondary display automatically* toggle only applies to Mirrored mode — Extended mode always presents on the secondary display.

Remote Control from a second Mac (below) is unaffected by the display mode and remains the right tool when the assistant sits at a genuinely separate machine.

## Features

- **Script editor** — plain-text editing, so pasting from Word/Docs/Notes strips all formatting automatically. Import from `.txt`, `.md`, and `.docx`. Live prompter preview with adjustable text size and an ALL CAPS toggle.
- **Jump markers** — put `---` (or `[BREAK]`) alone on a line to mark a jump point. Markers show as amber pills in the editor and as labeled dividers in the preview; in Present Mode they're invisible jump targets.
- **Script library** — scripts autosave locally as flat JSON files (`~/Library/Application Support/labprompter/scripts/`). Open, rename, and delete from the Library panel.
- **Present Mode** — fullscreen, black background, white text, zero chrome. A subtle reading line marks the current position, with an optional thin progress bar along the bottom. The cursor auto-hides, and the display is kept awake while presenting.
- **Extended display mode** — for setups where Screen 2 *extends* the desktop instead of mirroring it: Present opens on the prompter display while a separate **Operator View** window stays on Screen 1 with a live mirror, upcoming lines, section position, live speed, controller status, and all Present Mode controls — plus **live script editing** that updates the teleprompter as you type, without exiting Present Mode or moving the talent's reading position.
- **Shuttle control** — spring-loaded shuttle ring sets scroll speed proportionally (gentle twist = slow crawl, full twist = fast), the free-spinning jog dial nudges/scrubs, and all buttons are remappable in Settings.
- **Stream Deck plugin** — a bundled plugin (`streamdeck/`) puts prompter keys on an Elgato Stream Deck: Play, Pause, hold-to-scroll up/down, Top, Previous/Next Section, Text Bigger/Smaller, speed, eye line, ALL CAPS, and Present Mode toggle.
- **Network remote control** — a second Mac running LabPrompter can drive the studio machine. Instances broadcast themselves over Bonjour; click **Remote**, pick the studio Mac, and your keyboard and shuttle control its prompter while a scaled live mirror shows exactly what the talent sees — with the same live script editing as the Operator View. A dead-man safety zeroes the shuttle if the connection drops.
- **Local control API** — anything that can send an HTTP request can drive the prompter: `POST http://127.0.0.1:43717/command` with a plain-text command name; `GET /state` returns `{ presenting, playing }`. Bound to localhost only.
- **Keyboard fallback** — everything works without any controller.

## Controls in Present Mode

| Input | Action |
| --- | --- |
| Shuttle ring | Scroll speed (proportional, both directions) |
| Jog dial | Nudge / scrub |
| `Space` | Play / pause (scrolls at base speed) |
| `↓` / `↑` | Nudge one line forward / back |
| `→` / `←` | Base speed up / down |
| `Page Down` / `Page Up` (or `]` / `[`) | Next / previous marker |
| `Home` / `End` | Jump to top / end |
| `-` / `=` | Text size down / up (keeps your place in the script) |
| `Shift+↑` / `Shift+↓` | Eye line up / down — move the reading line to match the lens |
| `C` | Toggle ALL CAPS |
| `R` | Reverse direction |
| `Esc` | Exit to editor |

Speeds are percentages: **100% = 600 px/s**, a fast read. A normal talking pace lands around 8–15% at the default text size; the base play speed defaults to 10%. Shuttle and jog have their own sensitivity percentages (100% = default feel).

Default controller buttons (remap in Settings — press a button there to identify it): **1** jump to top, **2** previous marker, **3** play/pause, **4** next marker, **5** exit Present Mode. Buttons can also be bound to text size up/down and the ALL CAPS toggle. The ShuttlePRO v2 (15 buttons) is also recognized.

## Remote control from a second Mac

Run LabPrompter on both machines. On the assistant's Mac, click **Remote** — instances on the LAN appear automatically (Bonjour, service type `_labprompter._tcp`, TCP port 43718); there's also a connect-by-address field for networks that block mDNS. Once connected:

- The window becomes a live, scaled mirror of the studio prompter — reading line, progress, play state — so the assistant always sees the read position (put an NDI monitor of the talent in a window beside it).
- The assistant's **keyboard uses the same keys as Present Mode**, and a shuttle controller plugged into *their* machine drives the studio prompter (button mappings come from the studio Mac's settings).
- Press **E** (or **Edit script**) to open a live-edit pane: changes are sent to the studio Mac and appear on its prompter as the assistant types, with the same reading-position preservation as local live editing, and autosave into the studio's script library. Both machines must run a version that speaks the `edit` message (an older studio silently ignores it). Esc closes the pane; a second Esc disconnects.
- Commands travel as discrete speed-state events, so scrolling stays smooth regardless of network jitter; if the remote's connection drops while the shuttle is deflected, the studio side zeroes it within 2 seconds.
- `Esc` or **Disconnect** returns to the local editor. Untick *Allow network remote control* in Settings to stop the studio Mac accepting connections (and its Bonjour broadcast).

Anyone on the LAN can connect while remote control is allowed — it's designed for closed studio networks.

## Stream Deck

The plugin in `streamdeck/com.labprompter.streamdeck.sdPlugin` adds a **Prompter Command** action: drop it on a key, then pick the command in the key's settings (Play, Pause, Scroll Down/Up — these two scroll while held — Top, Previous/Next Section, Text Bigger/Smaller, Speed ±, Eye Line, ALL CAPS, Present Mode). Play/Pause toggle keys live-update to show ▶ or ❚❚. Keys work regardless of which app has focus, since the plugin talks to LabPrompter's local control API rather than sending keystrokes.

To install, copy the plugin folder and relaunch the Stream Deck app:

```bash
cp -R streamdeck/com.labprompter.streamdeck.sdPlugin ~/Library/Application\ Support/com.elgato.StreamDeck/Plugins/
```

If a key shows a warning triangle when pressed, LabPrompter isn't running.

## Icons

All icons (macOS `build/icon.icns`, dev dock icon, Stream Deck key/action icons) are generated from one canvas drawing. To regenerate after tweaking `tools/icons.js`:

```bash
npx electron tools/make-icons.js && iconutil -c icns build/icon.iconset -o build/icon.icns
```

## Running it

```bash
npm install
npm start
```

`npm install` downloads Electron; `node-hid` ships prebuilt N-API binaries, so no compiler toolchain is needed.

To build a standalone app (`dist/LabPrompter.app`, unsigned):

```bash
npm run dist
```

## Releasing updates

The installed app checks GitHub Releases on launch (via `electron-updater`), downloads any newer version in the background, and offers "Install & Restart" — never while Present Mode is up. To ship an update:

1. Bump `version` in `package.json` (updates only trigger on a higher version).
2. Commit, then build and upload:

```bash
GH_TOKEN=$(gh auth token) npm run release
```

3. electron-builder creates a **draft** release on GitHub with the dmg/zip and update manifest — open it and press *Publish*. Installed apps will offer the update on their next launch.

The update feed requires the app to be able to read the repo's releases: either keep the repo public, or the studio Mac needs a `GH_TOKEN` available to the app for a private repo.

## Signing & notarization

Builds are configured for hardened runtime + entitlements, ready for Developer ID signing and notarization. One-time setup (needs the Apple Developer account holder):

1. Create a **Developer ID Application** certificate: Xcode → Settings → Accounts → your team → *Manage Certificates* → **+** → *Developer ID Application* (or create it at developer.apple.com and double-click to install). electron-builder automatically prefers it over an Apple Development certificate once it's in the keychain.
2. Create an **app-specific password** for notarization at appleid.apple.com → Sign-In & Security → App-Specific Passwords.
3. Export the notarization credentials as env vars when releasing:

```bash
APPLE_ID="you@example.com" APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" APPLE_TEAM_ID="YOURTEAMID" GH_TOKEN=$(gh auth token) npm run release
```

With those set, electron-builder signs with Developer ID, submits to Apple's notary service, and staples the ticket — the dmg then opens cleanly on any Mac. Without them, builds still sign with the development certificate and skip notarization (fine for the studio Mac itself).

## Troubleshooting

- **Controller does nothing** — check the status dot in the editor's bottom-left corner. If it says "No controller", re-plug the device (LabPrompter re-scans every 3 seconds). Make sure Contour's own driver app isn't also running. If macOS is blocking HID access, grant your terminal (or the built app) **Input Monitoring** in System Settings → Privacy & Security.
- **"Controller support unavailable"** — the native HID module failed to load for your Electron version. Run `npx @electron/rebuild -f -w node-hid` inside the project and restart.
- **Present Mode opened on the wrong screen** — untick *Present on secondary display automatically* in Settings, drag the window to the right screen, and present again; or make the prompter's mirror set the non-primary display.

## Out of scope for v1

- Voice sync / auto-scroll from speech
- Multi-user or networked control
- Stream Deck SDK plugin (the keyboard fallback covers hotkey binding for now)
