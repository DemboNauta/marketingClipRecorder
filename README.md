# Marketing Clip Recorder

A Chrome extension for recording browser tabs with automatic smooth zoom effects on every click — perfect for creating polished product demos and marketing videos without any post-production effort.

---

## Preview

> **Popup — start/stop recording**

<img width="359" height="249" alt="image" src="https://github.com/user-attachments/assets/2f74ef6c-7a75-4a18-95f4-0208fb25d1a7" />


> **Clip Editor — timeline & zoom controls**

<img width="1916" height="990" alt="image" src="https://github.com/user-attachments/assets/3a031412-361c-4eb2-864f-39ac2b1124e3" />


---

## Features

- **One-click tab recording** — captures the active tab's video and audio via Chrome's `tabCapture` API.
- **Automatic click detection** — every click you make during recording is logged with its exact timestamp and position.
- **Smooth zoom on clicks** — the editor renders a cinematic zoom-in/hold/zoom-out effect centered on each detected click.
- **Visual click indicator** — optional red dot overlay that appears at the cursor position during recording.
- **Built-in clip editor** — interactive timeline with per-click zoom settings (intensity, ease-in duration, hold time, ease-out duration, and time offset).
- **Global defaults** — set zoom parameters once and apply them to all clicks at once.
- **Video export** — renders the final clip with all zoom effects baked in and downloads it as a video file.
- **Keyboard shortcut** — `Alt + S` stops the recording from any tab without opening the popup.

---

## How it works

```
Recording tab  →  tabCapture stream  →  Offscreen document (MediaRecorder)
                                                  ↓
                              content.js logs click events (x, y, timestamp)
                                                  ↓
                              Editor tab opens when recording finishes
                                                  ↓
                    Canvas renders video + zoom animations frame by frame
                                                  ↓
                                      Exported video file downloaded
```

---

## Installation

This extension is not published on the Chrome Web Store. Install it as an unpacked extension:

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.
5. The extension icon will appear in your toolbar.

---

## Usage

1. Navigate to the browser tab you want to record.
2. Click the extension icon and press **Record** (or use `Alt + S` to toggle).
3. Interact with the page naturally — click on anything you want to highlight.
4. Stop the recording via the popup button or `Alt + S`.
5. The **Clip Editor** opens automatically in a new tab.
6. Review the click list on the sidebar. Adjust zoom settings per click if needed.
7. Use **Preview** to play back the result, then **Export video** to download the final file.

---

## Project structure

```
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — orchestrates recording flow
├── content.js             # Injected into recorded tab — tracks click events
├── offscreen.js           # Offscreen document — runs MediaRecorder
├── offscreen.html
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.js
│   └── popup.css
├── editor/
│   ├── editor.html        # Clip editor page
│   ├── editor.js          # Canvas renderer + zoom engine + export
│   └── editor.css
└── icons/
```

---

## Requirements

- Google Chrome (or any Chromium-based browser that supports Manifest V3 and `tabCapture`).
- No external dependencies — everything runs locally in the browser.

---

## License

MIT License — Copyright (c) 2026 Edgar Milá

Free to use, modify, distribute, and use commercially. See [LICENSE](LICENSE) for details.
