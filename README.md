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

## Features

- **Script editor** — plain-text editing, so pasting from Word/Docs/Notes strips all formatting automatically. Import from `.txt`, `.md`, and `.docx`. Live prompter preview with adjustable text size.
- **Jump markers** — put `---` (or `[BREAK]`) alone on a line to mark a jump point. Markers show as amber pills in the editor and as labeled dividers in the preview; in Present Mode they're invisible jump targets.
- **Script library** — scripts autosave locally as flat JSON files (`~/Library/Application Support/labprompter/scripts/`). Open, rename, and delete from the Library panel.
- **Present Mode** — fullscreen, black background, white text, zero chrome. A subtle reading line marks the current position, with an optional thin progress bar along the bottom. The cursor auto-hides, and the display is kept awake while presenting.
- **Shuttle control** — spring-loaded shuttle ring sets scroll speed proportionally (gentle twist = slow crawl, full twist = fast), the free-spinning jog dial nudges/scrubs, and all buttons are remappable in Settings.
- **Keyboard fallback** — everything works without the controller (and these keys are what a Stream Deck can send later).

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
| `R` | Reverse direction |
| `Esc` | Exit to editor |

Default controller buttons (remap in Settings — press a button there to identify it): **1** jump to top, **2** previous marker, **3** play/pause, **4** next marker, **5** exit Present Mode. The ShuttlePRO v2 (15 buttons) is also recognized.

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

## Troubleshooting

- **Controller does nothing** — check the status dot in the editor's bottom-left corner. If it says "No controller", re-plug the device (LabPrompter re-scans every 3 seconds). Make sure Contour's own driver app isn't also running. If macOS is blocking HID access, grant your terminal (or the built app) **Input Monitoring** in System Settings → Privacy & Security.
- **"Controller support unavailable"** — the native HID module failed to load for your Electron version. Run `npx @electron/rebuild -f -w node-hid` inside the project and restart.
- **Present Mode opened on the wrong screen** — untick *Present on secondary display automatically* in Settings, drag the window to the right screen, and present again; or make the prompter's mirror set the non-primary display.

## Out of scope for v1

- Voice sync / auto-scroll from speech
- Multi-user or networked control
- Stream Deck SDK plugin (the keyboard fallback covers hotkey binding for now)
