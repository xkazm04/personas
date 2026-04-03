---
name: record-demo
description: Record feature demo walkthrough with Playwright, generate commentary subtitles, produce final video with ffmpeg
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
argument-hint: <feature to demo, e.g. "template adoption wizard" or "sidebar navigation">
---

# Record Demo — Codebase-Aware Feature Walkthrough Capture

Record a polished demo video of any feature in the personas-desktop Tauri app. Analyzes the codebase to understand UI flows, generates a Playwright walkthrough script, captures video, writes a commentary subtitle track, and produces a final MP4 with burned-in subtitles via ffmpeg.

## Prerequisites

- Playwright and ffmpeg are available on this machine (globally installed)
- The dev server runs at `http://localhost:1420` (Tauri Vite dev server)

## IMPORTANT: Tauri App Limitation

This app is a **Tauri desktop app**. The Vite dev server at port 1420 serves the frontend HTML/JS but the app requires the Tauri IPC bridge to function — stores populate from Rust backend commands, not from the browser alone. Playwright headless browser against port 1420 will see the HTML but interactive elements won't work because the backend is absent.

**Workaround for Tauri apps:**
1. Start the full Tauri app: `npm run tauri dev -- --features test-automation`
2. Use the test automation HTTP API at `http://127.0.0.1:17320` to drive the real app
3. For video capture, use OS-level screen recording (e.g., ffmpeg with gdigrab on Windows, or Tauri's WebView remote debugging port for CDP)

**Alternative approach — CDP via Tauri WebView:**
If Tauri is started with `WEBKIT_INSPECTOR_SERVER` or Chromium remote debugging enabled, Playwright can connect via `chromium.connectOverCDP()` to the running WebView instead of launching a new browser.

**Screen capture approach (Windows):**
Use ffmpeg gdigrab to capture the desktop while driving the app via test automation:
```bash
# Start screen capture
ffmpeg -f gdigrab -framerate 24 -t 20 -i desktop -c:v libx264 -crf 23 recordings/demo.mp4 -y &
# Drive app via test automation API
curl -X POST http://127.0.0.1:17320/navigate -d '{"section":"settings"}'
# etc.
```
This captures the full desktop — best combined with app window being maximized/focused.

**Recommended approach for Tauri (TODO):**
1. Add `--remote-debugging-port=9222` to Tauri's WebView configuration
2. Use `chromium.connectOverCDP('http://127.0.0.1:9222')` in Playwright
3. This gives full Playwright API (video recording, selectors, screenshots) against the real running app

---

## Step 1: Gather Requirements

If the user provided a feature description as the argument, use it. Otherwise ask:

> **What feature would you like to demo?**
> Describe the workflow or area (e.g., "the template adoption wizard from gallery to persona creation", "the manual review triage flow", "sidebar navigation and subtab switching").
>
> **Any specific requirements?**
> - Viewport size (default: 1280x800)
> - Speed: slow / normal / fast (default: normal)
> - Include test data or specific state? (e.g., "show with 5 review items pending")

Capture the answers. Set defaults:
- **Viewport**: 1280x800
- **Speed**: normal (1500ms delay between steps)
  - slow = 2500ms, fast = 800ms
- **Output dir**: `recordings/` in project root

---

## Step 2: Analyze the Feature in Codebase

Use Glob, Grep, and Read to deeply understand the feature before writing any script.

### 2a. Find the routes and pages

```
Glob: src/features/**/index.ts, src/features/**/Page.tsx, src/features/**/*Page.tsx
Grep: pattern matching the feature name in route definitions
Read: src/App.tsx or main router file for route mapping
```

### 2b. Find the components involved

Search for component files related to the feature:
```
Grep: feature keywords across src/features/
Read: key component files to understand:
  - What elements are interactive (buttons, inputs, links, tabs)
  - What data/state drives the UI
  - CSS selectors or test IDs for reliable targeting
```

### 2c. Map the user flow

Build a mental model of the walkthrough:
1. **Entry point**: Which URL/route starts the feature
2. **Interaction sequence**: Click targets, form inputs, navigation steps
3. **Wait conditions**: What signals the UI is ready (loading spinners gone, animations complete)
4. **Key visuals**: What the viewer should notice at each step

### 2d. Check for reliable selectors

Prefer selectors in this order:
1. `data-testid` attributes (most stable)
2. `role` + accessible name: `page.getByRole('button', { name: 'Submit' })`
3. Text content: `page.getByText('Create Persona')`
4. CSS class chains (least stable, last resort): `page.locator('.sidebar-nav .active')`

Read the actual component source to find the best selectors. NEVER guess selectors.

---

## Step 3: Generate the Walkthrough Plan

Before writing any code, output a numbered plan for the user:

```
Walkthrough Plan: [Feature Name]
================================
1. [0:00] Navigate to http://localhost:1420/[route] — landing view
2. [0:02] Click "[button text]" — opens the [panel/modal/page]
3. [0:05] Fill in "[field]" with "[test value]" — demonstrates input
4. [0:08] Click "[next action]" — transitions to [next state]
...
Estimated duration: ~[N] seconds
Steps: [N]
```

Wait for the user to confirm or adjust the plan.

---

## Step 4: Generate the Playwright Script

Write a standalone Node.js script to `recordings/_walkthrough.mjs`:

```javascript
// recordings/_walkthrough.mjs
import { chromium } from 'playwright';

const DELAY = 1500; // adjusted by speed setting
const wait = (ms) => new Promise(r => setTimeout(r, ms ?? DELAY));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: {
    dir: './recordings/',
    size: { width: 1280, height: 800 },
  },
});
const page = await context.newPage();

// ── Step 1: Navigate to app ──────────────────────────────────
await page.goto('http://localhost:1420/[route]');
await page.waitForLoadState('networkidle');
await wait();

// ── Step 2: [Description] ───────────────────────────────────
await page.getByRole('button', { name: '[text]' }).click();
await wait();

// ... (one section per walkthrough step)

// ── Finalize ─────────────────────────────────────────────────
await wait(2000); // hold final frame
await context.close(); // triggers video save
await browser.close();

console.log('Recording complete. Video saved to recordings/');
```

### Script generation rules:

1. **One clearly commented section per walkthrough step** — makes it easy to correlate with subtitles
2. **Always `waitForLoadState('networkidle')` after navigation** — Tauri app loads async data
3. **Use `wait()` after every interaction** — gives the UI time to animate and settle
4. **Use `page.waitForSelector()` before interacting** — don't click elements that haven't rendered
5. **Wrap each step in try/catch** — log failures but continue recording (partial demos are still useful)
6. **Hold the final frame for 2 seconds** — gives viewers time to see the end state
7. **Use `headless: true`** — we're capturing via Playwright's video, not the visible browser
8. **Include a `console.log` timestamp at each step** — helps align subtitles later

### Handling app state

If the demo requires specific data (e.g., existing personas, pending reviews):
- Check if the data exists by reading the app's SQLite database or API responses
- If test data is needed, note it in the plan and ask the user if they want to seed it first
- For read-only demos, use whatever state currently exists

---

## Step 5: Ensure Dev Server is Running

Before executing the script, verify the dev server is up:

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:1420
```

If it returns non-200:
- Tell the user: "The dev server doesn't appear to be running. Start it with `npm run dev` in another terminal, then tell me to continue."
- Do NOT start the dev server yourself (it blocks the terminal)

---

## Step 6: Execute the Walkthrough

Run the Playwright script:

```bash
node recordings/_walkthrough.mjs
```

If it fails:
1. Read the error output
2. Identify the failing step (selector not found, timeout, navigation error)
3. Fix the script — adjust the selector, add a longer wait, or skip the step
4. Retry (max 3 attempts)

After success, find the recorded video:
```bash
ls -t recordings/*.webm | head -1
```

Playwright saves videos as `.webm` files with auto-generated names.

---

## Step 7: Generate Subtitle Script

Create an SRT subtitle file at `recordings/_subtitles.srt` based on the walkthrough plan.

### SRT format:

```
1
00:00:00,000 --> 00:00:02,500
Opening the template gallery — browse available persona templates

2
00:00:02,500 --> 00:00:05,500
Selecting the "Dev Clone" template — autonomous developer persona

3
00:00:05,500 --> 00:00:09,000
The adoption wizard opens — five steps: Choose, Connect, Tune, Build, Create
```

### Subtitle rules:

1. **One subtitle per walkthrough step** — matches the script sections
2. **Duration = delay between steps** (default 1500ms per step, adjusted by speed)
3. **Format: [Action] — [Context/Value]** — what's happening and why it matters
4. **Max 2 lines, ~60 chars per line** — readable at video resolution
5. **No technical jargon** — write for someone seeing the feature for the first time
6. **Timestamps must align with actual step timing** — account for `waitForLoadState` and explicit waits in the script

### Calculating timestamps:

Walk through the Playwright script and sum up the delays:
- `page.goto()` + `waitForLoadState('networkidle')` ≈ 2000ms (estimate, varies)
- `wait()` = configured delay (1500ms default)
- `wait(N)` = explicit N ms
- `page.waitForSelector()` ≈ 500ms average

Build a cumulative timeline from these estimates.

---

## Step 8: Burn Subtitles with ffmpeg

Merge the video and subtitles into a final MP4:

```bash
ffmpeg -y -i "recordings/[video-file].webm" \
  -vf "subtitles=recordings/_subtitles.srt:force_style='FontSize=22,FontName=Arial,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2,Shadow=1,MarginV=35'" \
  -c:v libx264 -crf 23 -preset fast \
  -c:a aac -b:a 128k \
  "recordings/demo-[feature-name].mp4"
```

### ffmpeg options explained:
- `-vf subtitles=...` — burns SRT into the video frames (no separate subtitle track)
- `PrimaryColour=&H00FFFFFF&` — white text
- `OutlineColour=&H00000000&` — black outline for readability
- `Outline=2, Shadow=1` — readable on any background
- `MarginV=35` — bottom margin so subtitles don't overlap UI
- `-crf 23` — good quality/size balance
- `-preset fast` — reasonable encode speed

If ffmpeg is not in PATH or fails, output a warning and provide the raw `.webm` + `.srt` files as the deliverable instead.

---

## Step 9: Cleanup & Report

After successful recording:

1. **Delete the intermediate `.webm` file** (the `.mp4` is the deliverable)
2. **Keep the Playwright script** (`_walkthrough.mjs`) — useful for re-recording
3. **Keep the subtitle file** (`_subtitles.srt`) — useful for editing

Report to the user:

```
Demo recorded successfully!

  Video:     recordings/demo-[feature].mp4
  Duration:  ~[N]s
  Steps:     [N] walkthrough steps
  Subtitles: recordings/_subtitles.srt (burned in)
  Script:    recordings/_walkthrough.mjs (re-runnable)

To re-record with changes:
  1. Edit recordings/_walkthrough.mjs
  2. Run: node recordings/_walkthrough.mjs
  3. Re-run /record-demo to regenerate subtitles and merge
```

---

## Codebase Reference

### App structure (for feature discovery)
```
src/features/
  agents/          — Persona detail, executions, activity
  overview/        — Dashboard, events, reviews, memories, messages, usage
  templates/       — Template gallery, adoption wizard, import flows
  shared/          — Layout, sidebar, forms, modals, display components
  plugins/         — Dev Tools, OCR, integrations
  vault/           — Knowledge base, vector store
  sharing/         — Bundle import/export
```

### Key routes (for navigation targets)
```
/                  — Overview dashboard
/personas/:id     — Persona detail (agents feature)
/templates        — Template gallery
/templates/:id    — Template detail / adoption
/settings         — App settings
/plugins/dev-tools — Dev Tools projects
```

### Sidebar navigation
The app uses a 2-level sidebar: `SidebarLevel1.tsx` for top sections, `SidebarSubNav.tsx` for sub-tabs within each section. Tab switching is handled via `DashboardWithSubtabs.tsx` or equivalent container components.

### Common UI patterns
- **Modals**: Use `BaseModal` from `src/lib/ui/BaseModal.tsx` — wait for `[role="dialog"]`
- **Tabs/subtabs**: `SidebarSubNav` renders tab buttons — click by text content
- **Loading states**: Components show `Loader2` spinner — wait until spinner is gone
- **Toast notifications**: Appear at top-right — may need to wait for them to clear
- **Data grids**: `DataGrid.tsx` renders tables — rows are `<tr>` elements
