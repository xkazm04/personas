---
name: record-demo
description: Record feature demo walkthrough with Playwright, generate commentary subtitles, produce final video with ffmpeg
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
argument-hint: <feature to demo, e.g. "template adoption wizard" or "sidebar navigation">
---

# Record Demo — Codebase-Aware Feature Walkthrough Capture

Record a polished demo video of a feature in the Personas desktop (Tauri) app. Pipeline: analyze the codebase → plan the shots → script the walkthrough → capture video → write commentary subtitles → burn a final MP4 with ffmpeg → verify the artifacts play.

## Prerequisites

- ffmpeg + ffprobe on PATH (Playwright optional — only for the CDP variant below)
- Output dir: `recordings/` in project root (create if missing)

## Ground truth: how this app must be driven

This is a **Tauri desktop app**. The Vite dev server (:1420) serves HTML only — stores populate from Rust IPC, so Playwright pointed at `http://localhost:1420` renders a dead shell. **Never script against :1420.**

**Primary path (reliable):** drive the real app through the test-automation HTTP server on `http://127.0.0.1:17320`, started via `npm run tauri:dev:test` (lite features + `test-automation`; `tauri:dev:test:full` if the demo needs ML/P2P). Capture video with ffmpeg gdigrab of the app window.

**Alternative (only if a WebView remote-debugging port is already configured):** Playwright `chromium.connectOverCDP()` to the running WebView gives native `recordVideo` and selectors. Do not add debugging-port config yourself just for a demo — prefer the harness path.

Navigation is **section-based, not URL routes**. `POST /navigate {"section":"<id>"}` switches the sidebar section (ids from `SidebarSection` — home, overview, personas, templates, settings, …). There are no `/templates`-style URLs to `goto`.

### Harness reliability rules (hard-won — do not skip)

1. **Avoid `/eval` for interactions.** The `/eval` queue silently drops scripts mid-session — a demo dies halfway with no error. Use the semantic routes instead: `/navigate`, `/click-testid` (`{"testId":"…"}`), `/fill-field`, `/click`, `/type`, `/wait` (`{"selector","timeoutMs"}`), `/wait-toast`, `/select-agent`, `/open-editor-tab`, `/open-settings-tab`, `/search-agents`, `/adopt-template`, `/execute-persona`.
2. **Never read state through `/eval`** — it returns only `{success:true}`. Read the DOM via `POST /query`, `POST /find-text`, `GET /state`, `GET /snapshot`, `GET /list-interactive`.
3. **Never reuse a stale instance across builds.** Before launching: if :17320 already answers, it may be an old build — find the PID (`netstat -ano | findstr :17320`) and stop it unless you know it's current. After boot: `GET /health` proves *a* server is up, not *yours* — additionally assert something known-new (a testid or `/state` field that exists in the current build). Bridge-wait logic adopts the FIRST responder on the port.
4. **Anchor recovery — re-derive, don't retry blind.** If a step can't find its target, do NOT loop retries. Grep the feature's source for `data-testid` (1,000+ exist across `src/features/`), pick the real testid, and use `/click-testid`. If none exists nearby, fall back to `/find-text` + `/click` with a selector read from the component source.
5. **`/screenshot`** (`{"saveDir","filename","maxWidth?","windowTitle?"}`) saves a PNG of the app window — use it to verify visual state between beats without touching the recording.

---

## Step 1: Gather Requirements

Use the argument if provided; otherwise ask:

> **What feature would you like to demo?** (e.g., "template adoption from gallery to persona creation")
> **Any specifics?** Viewport/window size, speed (slow/normal/fast), required app state (e.g., "5 pending reviews").

Defaults: window ~1280x800, speed normal (1500ms between beats; slow 2500ms, fast 800ms), output `recordings/`.

---

## Step 2: Analyze the Feature in Codebase

Understand the flow before scripting anything.

1. **Locate the feature**: Glob/Grep under `src/features/<area>/`; read the entry component and its container to learn which sidebar section + subtab hosts it.
2. **Map interactions**: read component source for buttons, inputs, tabs — and collect their `data-testid` attributes. **Never guess selectors**; every anchor in the script must be traceable to a line of source. Selector preference: `data-testid` → visible text (`/find-text`) → CSS selector from source (last resort).
3. **Map state needs**: if the demo needs data (personas, reviews, templates), check what exists via `GET /state`, `GET /agent-cards`, or `POST /overview-counts` once the app is up. If seeding is needed, note it in the plan and ask the user first.
4. **Wait conditions**: identify what signals "ready" after each action (a testid appearing, a spinner gone, `/wait-toast`).

---

## Step 3: Shot Plan (user gate)

Before writing code, list the **beats** — one line per shot — and get user confirmation:

```
Shot Plan: [Feature Name]
=========================
1. [0:00] Land on Templates section — gallery grid (HOLD 2.5s: orientation)
2. [0:03] Click template card "Dev Clone" (testid: template-card-dev-clone) — detail opens
3. [0:06] Click "Adopt" — wizard step 1 (HOLD 3s: PAYOFF — the 5-step rail)
...
Estimated duration: ~[N]s · [N] beats
```

**Pacing rules:**
- Open with a 2-3s orientation hold on the landing view.
- **Pause 2-3s on payoff screens** (the moment the feature delivers — a created persona, a filled dashboard). Mark these `PAYOFF` in the plan.
- **No dead time over 2s** on transitional screens — if a wait is longer, it's a bug in the script, not a pause.
- End with a 2-3s hold on the final state.

---

## Step 4: Generate the Walkthrough Script

Write a standalone Node driver to `recordings/_walkthrough.mjs` that calls the :17320 harness (plain `fetch`, no deps). One clearly commented section per beat; log a timestamp per beat (subtitle alignment depends on these logs).

```javascript
// recordings/_walkthrough.mjs — drives the LIVE app via the test-automation server
const BASE = 'http://127.0.0.1:17320';
const DELAY = 1500; // per speed setting
const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const wait = (ms = DELAY) => new Promise(r => setTimeout(r, ms));
const post = async (route, body = {}) => {
  const res = await fetch(BASE + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${route} → ${res.status}: ${await res.text()}`);
  return res.text();
};

// ── Beat 1: Land on Templates ────────────────────────────────
await post('/navigate', { section: 'templates' });
await post('/wait', { selector: '[data-testid="template-gallery"]', timeoutMs: 10000 });
log('beat 1: templates gallery');
await wait(2500); // orientation hold

// ── Beat 2: Open a template ─────────────────────────────────
await post('/click-testid', { testId: 'template-card-dev-clone' });
await post('/wait', { selector: '[data-testid="template-detail"]', timeoutMs: 8000 });
log('beat 2: template detail');
await wait();

// … one section per beat …

log('done'); await wait(2500); // final hold
```

Script rules:
1. `/wait` on a source-verified selector before every interaction — never click blind.
2. Wrap each beat in try/catch: on failure, log the beat + error and **stop** (a broken take is re-recorded, not salvaged mid-capture). Then apply anchor-recovery rule 4 above and fix the script.
3. After state-changing beats, verify via `/query` or `/find-text` that the expected result is on screen — do not trust `{success:true}`.
4. Timestamps from `log()` are the subtitle timeline — keep them accurate.

*(CDP variant: if a debugging port exists, the same beats become a Playwright script with `connectOverCDP` + `recordVideo`; interaction and verification rules are identical.)*

---

## Step 5: Launch & Verify the App

1. Check :17320 per reliability rule 3 (kill stale instance if needed).
2. Have the user run `npm run tauri:dev:test` in another terminal (do NOT start it yourself — it blocks), or confirm a current instance is already up.
3. Verify boot: `curl -s http://127.0.0.1:17320/health` returns `{"status":"ok",...}` **and** a known-current probe passes (e.g. `/wait` on a testid you read from today's source).
4. Ask the user to maximize/focus the app window (gdigrab captures the window as-is).

---

## Step 6: Record the Take

1. Start capture of the app window in the background:
   ```bash
   ffmpeg -y -f gdigrab -framerate 24 -i title=Personas -c:v libx264 -crf 23 -pix_fmt yuv420p recordings/_take.mp4
   ```
   (If the window title doesn't match, capture `-i desktop` with the window maximized.) Run it via a background Bash call; stop it after the driver finishes (send `q` / kill the ffmpeg PID).
2. Run the driver: `node recordings/_walkthrough.mjs`.
3. If a beat fails: read the driver log, re-derive the failing anchor from source (rule 4), fix `_walkthrough.mjs`, and **re-record the whole take** (max 3 takes; then report the blocker to the user).
4. Note the driver's per-beat timestamps — they are the subtitle timeline.

---

## Step 7: Generate Subtitles

Write `recordings/_subtitles.srt` — one cue per beat, timed from the driver's logged timestamps (not estimates), offset by when capture started relative to the driver.

```
1
00:00:00,000 --> 00:00:02,500
Browsing the template gallery

2
00:00:02,500 --> 00:00:05,500
Opening the Dev Clone template
```

**Subtitle style contract:**
- **Present tense, active voice** ("Opening the wizard", not "The wizard will open").
- **Short**: one line preferred, max 2 lines × ~50 chars.
- **No jargon** — write for someone seeing the product for the first time (no "IPC", "store", "testid"; product terms like *persona* and *template* are fine).
- Each cue says what's happening and why it matters, not which button was clicked.
- Cues span their full beat (hold cues stay up through the hold); no gaps mid-demo.

---

## Step 8: Burn Subtitles with ffmpeg

```bash
ffmpeg -y -i recordings/_take.mp4 \
  -vf "subtitles=recordings/_subtitles.srt:force_style='FontSize=22,FontName=Arial,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2,Shadow=1,MarginV=35'" \
  -c:v libx264 -crf 23 -preset fast \
  "recordings/demo-[feature-name].mp4"
```

White text, black outline, bottom margin so subtitles don't cover UI. If the burn fails, deliver `_take.mp4` + `_subtitles.srt` and say so.

---

## Step 9: Verify Artifacts, Cleanup & Report

**Do not declare done until both artifacts verify:**

```bash
ffprobe -v error -show_entries format=duration:stream=codec_name -of default=nw=1 "recordings/demo-[feature].mp4"
```
- Duration > 0 and roughly matches the shot plan; an h264 video stream is present. A zero/absent duration means a truncated capture — re-record.
- `_subtitles.srt` exists, is non-empty, and its last cue ends within the video duration.
- Spot-check: extract a mid-video frame (`ffmpeg -ss <mid> -i demo.mp4 -frames:v 1 recordings/_check.png`) and Read it — confirm the app UI (not a black/desktop frame) and legible subtitles. Delete `_check.png` after.

Cleanup: delete `_take.mp4`; keep `_walkthrough.mjs` and `_subtitles.srt` for re-recording.

Report:
```
Demo recorded and verified.
  Video:     recordings/demo-[feature].mp4  (~[N]s, [N] beats, subtitles burned in)
  Script:    recordings/_walkthrough.mjs    (re-runnable against :17320)
  Subtitles: recordings/_subtitles.srt
To re-record: fix the script, restart capture (Step 6), re-run Steps 7-9.
```

---

## Codebase Reference

```
src/features/
  agents/     — persona detail, executions, lab      overview/  — dashboard, events, reviews
  templates/  — gallery, adoption wizard             vault/     — credentials, connectors
  shared/     — components + chrome (sidebar)        plugins/   — dev-tools, companion, …
```

- **Sidebar**: `src/features/shared/chrome/sidebar/` — `SidebarLevel1.tsx` (sections), `SidebarSubNav.tsx` (subtabs). Drive via `/navigate` sections, not clicks, unless the navigation itself is the demo.
- **Modals**: `BaseModal` (`src/features/shared/components/modals/`) — wait for `[role="dialog"]`.
- **Loading**: spinner components — wait for a content testid to appear rather than for the spinner to vanish.
- **Toasts**: use `/wait-toast` to sync on success feedback.
