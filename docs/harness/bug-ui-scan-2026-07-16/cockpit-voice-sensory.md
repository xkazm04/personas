# Cockpit, Voice & Sensory — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 4, Low: 0)

Note: the context file list is stale — `src/features/plugins/companion/sub_voice/PiperVoicePanel.tsx` no longer exists (Piper/ElevenLabs descoped 2026-07-10; the live panels are `VoicePanel.tsx` / `KokoroVoicePanel.tsx` / `PocketVoicePanel.tsx`).

## 1. Zero-persona install: CockpitPanel fires an infinite fetchPersonas + metrics IPC loop
- **Severity**: High
- **Category**: bug
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:65-70 (root cause also src/stores/slices/agents/personaSlice.ts:103-119)
- **Scenario**: A brand-new install (or any fleet with 0 personas) opens Home → Cockpit — exactly the state where the "talk to Athena" empty CTA is shown.
- **Root cause**: The effect `if (!personas || personas.length === 0) fetchPersonas()` depends on `[personas, fetchPersonas]`. `fetchPersonas` always writes a **new array identity** (`mergeHeavyFields` returns `incoming.map(...)`, a fresh `[]` even when empty), `useShallow` compares by reference, so the effect re-fires; the emptiness guard stays true forever. `getMetricsSummary(7)` is unconditional inside the same effect, so it rides along every iteration.
- **Impact**: Unbounded retry storm: `list_personas` + metrics-summary IPC round-trips back-to-back for as long as the tab is mounted — CPU/DB churn, log spam, and re-render pressure on the first-run screen a new user is most likely to sit on.
- **Fix sketch**: Fetch once per mount (a `useRef` hasFetched guard, or depend on an `isLoading`/`hasLoaded` flag from the store instead of the array identity); alternatively make `fetchPersonas` bail-out set the same reference when the list is unchanged/empty.

## 2. Corrupt persisted cockpit spec renders a silent blank cockpit with no error or recovery
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:128-133, 259-267
- **Scenario**: `companion_get_cockpit` returns a spec whose `specJson` doesn't parse (truncated write, LLM emitted invalid JSON that was persisted, schema drift after an update). User opens the Cockpit tab.
- **Root cause**: The `JSON.parse` failure is `silentCatch`-swallowed, leaving `persistentBody = null` while `spec` stays truthy. The empty-state branch requires `!spec`, and `showDefault` requires `!spec`, so neither the CTA nor the deterministic default cockpit can render — the panel falls through to the widget grid with `widgets = []`.
- **Impact**: A completely blank body under a header that says "composed <time> ago". No error card, no retry, no CTA — the user has no signal anything is wrong and no path out short of asking Athena to recompose (which they aren't prompted to do).
- **Fix sketch**: Treat parse failure like fetch failure: set the `error` state (or a `parseError` flag) in the parse catch so the existing error-with-retry card renders, ideally with a "recompose with Athena" CTA.

## 3. Every window refocus unmounts the whole cockpit into a full-screen spinner
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:84-97, 244-246
- **Scenario**: User has a composed cockpit rendered, alt-tabs to another app, then clicks back into the window (the focus listener at line 106 calls `load()` on every focus).
- **Root cause**: `load()` sets `loading = true` unconditionally, and the render branch `!contextualCockpit && loading` takes precedence over the already-rendered spec — revalidation is treated the same as first load.
- **Impact**: Visible flash: the entire widget grid unmounts into a centered spinner on every refocus, then all widgets remount and re-run their own data fetches (persona_overview etc.), producing flicker plus a redundant fetch cascade several times a minute for a heavy alt-tabber.
- **Fix sketch**: Stale-while-revalidate: only show the spinner when `spec === null && !error` (initial load); keep the current grid mounted during focus refreshes and swap state in place when the new spec arrives.

## 4. Failed whisper download deletes sibling in-flight downloads' .partial files
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/companion/stt/downloader.rs:130-134, 204-219
- **Scenario**: User starts downloading two different whisper models (the UI allows it; `DOWNLOAD_INFLIGHT` is keyed per model). Model A's stream fails (network blip, HTTP error) while model B is still streaming.
- **Root cause**: The failure path calls `cleanup_partials(&dir)`, which removes **every** `*.partial` in the models dir, not just A's own partial — the design assumes at most one download is ever in flight, but the guard is per-model.
- **Impact**: On macOS/Linux, B's open partial is unlinked; B keeps writing to an anonymous inode and its final `rename` fails with NotFound, so a healthy download is reported failed by an unrelated one. On Windows the delete of the open file errors and is swallowed, masking the bug rather than fixing the design.
- **Fix sketch**: On failure, delete only this download's `partial_path` (`final_path.with_extension("bin.partial")`); reserve the directory-wide `cleanup_partials` sweep for startup, when no download can be in flight.

## 5. STT download progress is orphaned on unmount; retry renders a misleading "Failed" while the download is still running
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/companion/sub_voice/SttPanel.tsx:85, 129-199, 330-345
- **Scenario**: User starts a whisper model download (~466 MB for `small`), then flips the engine toggle to "Browser" (or navigates off the Voice tab) and comes back a moment later.
- **Root cause**: `WhisperConfig` unmounts when `engine !== 'whisper'`, and the `progress` map plus the `companion://stt-download` listener are component-local state — the backend download keeps streaming, but on remount the UI has no memory of it and no way to query in-flight downloads.
- **Impact**: The row shows the "Download" button again mid-download. Clicking it hits the backend inflight guard, whose "already downloading" rejection the catch handler maps to `state: 'failed'` — so the user sees a red "Failed" chip for a download that is actually progressing, and never sees a progress bar again until the completion event happens to arrive while remounted.
- **Fix sketch**: Lift `progress` into a store (or module-level cache) keyed by modelId so it survives remounts, and/or add a small `companion_stt_download_status` query consulted on mount; additionally, don't map the "already downloading" rejection to `failed` — restore the `downloading` state for that row.
