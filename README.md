# FocusRSVP — Attention-Aware RSVP Reading System

A human-factors prototype: an RSVP (one-word-at-a-time) speed reader that uses
**webcam-based attention detection** to auto-pause reading the moment you look
away, so no words are ever missed. Built with plain HTML/CSS/JS — no build step.

## The human factors problem

RSVP reading eliminates eye movement, but the text keeps moving even when the
reader doesn't. A one-second glance away = permanently missed words (a classic
**use error**). This system closes that gap: a webcam attention monitor pauses
reading when gaze is lost and logs every distraction event for analysis.

## File structure

```
Attention-Aware RSVP Reading System — Human Factors Prototype/
├── index.html                  # Single page: display, controls, modals
├── css/
│   └── style.css               # Dark minimal RSVP theme
└── js/
    ├── rsvp-engine.js          # Word parsing, ORP calc, WPM timing loop
    ├── attention-monitor.js    # MediaPipe FaceMesh: face / head pose / iris
    ├── distraction-controller.js # Debounced auto-pause / resume decisions
    ├── session-logger.js       # HF metrics + JSON export + localStorage
    ├── file-input.js           # Paste / .txt / .pdf (pdf.js) / sample text
    └── main.js                 # Wires everything + keyboard shortcuts
```

## Architecture

```
User Interface (index.html + style.css)
        │
RSVP Reading Engine (rsvp-engine.js)      ← word index, WPM, ORP, timers
        │
Attention Monitor (attention-monitor.js)  ← webcam + FaceMesh landmarks
        │
Distraction Controller (distraction-controller.js) ← pause/resume policy
        │
Experiment Logger (session-logger.js)     ← metrics + JSON export
```

## How to run

The app needs to be served over HTTP (webcam access is blocked on `file://`).

**Option 1 — Python (easiest):**
```bash
cd attention-rsvp
python3 -m http.server 8000
# open http://localhost:8000
```

**Option 2 — Node:**
```bash
npx serve attention-rsvp
```

**Option 3 — VS Code:** install the *Live Server* extension, right-click
`index.html` → "Open with Live Server".

Internet is required on first load (MediaPipe FaceMesh and pdf.js come from
CDNs). Use **Chrome or Edge** for best FaceMesh performance.

## Usage

1. Click **Load text** → paste text, upload a `.txt`/`.pdf`, or use the sample.
2. Click the **camera icon** (or press `C`) and allow webcam access.
   Wait for the pill to turn green: *Attention: active*.
3. Press **Space** to start reading. Look away for ~2 s → reading auto-pauses.
4. Press `M` for live session stats; **Export session JSON** for analysis.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause / resume |
| ← / → | Back / forward 10 words |
| ↑ / ↓ | WPM +25 / −25 |
| R | Restart |
| S | Settings |
| M | Stats |
| C | Toggle camera |

## How attention detection works

The monitor deliberately answers one *reliable* question — "is the user looking
at the screen?" — rather than estimating noisy exact gaze coordinates.
Per frame, from MediaPipe FaceMesh landmarks:

1. **Face present?** No face for >0.6 s → `FACE_NOT_FOUND`
2. **Head yaw** — nose offset vs. cheek midpoint, normalized by face width
3. **Head pitch** — nose vs. eye line (catches looking down at a phone)
4. **Iris offset** — iris position inside the eye corners (refined landmarks)
5. **Eyes closed** — eye aspect ratio (EAR)

Signals are smoothed with a moving average; if any exceeds its threshold →
`DISTRACTED`. The distraction controller then applies a **grace period**
(default 2 s, configurable 0.5–4 s) before auto-pausing, so quick blinks and
glances don't interrupt reading. Resume is **manual by default** (so reading
doesn't restart before you're mentally ready), with opt-in auto-resume.

Thresholds live in `AttentionMonitor.THRESH` (attention-monitor.js) if you
need to tune them for your camera/lighting.

## Logged metrics (per session)

`completionPercentage`, `wordsRead`, `initialWpm`/`finalWpm`,
`totalActiveReadingMs`, `autoPauseCount`, `manualPauseCount`,
`gazeLossEvents`, `totalDistractedMs`, `restartCount`, plus a full
timestamped event trail — exportable as JSON for your usability study
(Mode A: normal reading vs. Mode B: RSVP vs. Mode C: RSVP + attention-aware).
