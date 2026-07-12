> Context: plugins/companion [1/4]
> Total: 9
> Critical: 0  High: 1  Medium: 5  Low: 3

## 1. Incident-blocker "Resolve" clears the nudge in UI only — it re-surfaces on the next pump

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/plugins/companion/decision/useDecisionQueue.ts:150-200
- **Scenario**: The user picks "Resolve" on an `incident_blocker` orb decision. `incidentToDecision`'s resolve `run()` navigates to Overview → Incidents, deep-links the incident, and calls `useCompanionStore.getState().removeProactive(message.id)` — but it never calls a backend command. Meanwhile the "Dismiss" option DOES persist (`companionDismissProactive`). Because `runDecisionOption` then clears `pendingDecision`, `useDecisionQueue.pump()` re-fires and `buildQueue()` calls `companionListProactiveMessages(true)` fresh from the backend, which still returns the un-dismissed incident → the very same decision re-surfaces on the orb immediately.
- **Root cause**: The resolve path only mutates local Zustand state; the proactive row stays `pending` server-side, and the queue is rebuilt from the backend, not the store.
- **Impact**: UX — an incident the user just acted on keeps re-popping as a hands-free decision (a surfacing loop), and looks "stuck". Asymmetric with the dismiss path which is fire-safe.
- **Fix sketch**: In the resolve `run()`, after navigating, `await companionDismissProactive(message.id)` (or a dedicated "engage/acknowledge" command) before/alongside `removeProactive`, mirroring `messageAttentionToDecision`'s engage path; wrap in try/catch so a failed dismiss re-throws to keep the decision pending.

## 2. `useLocalDictation.start()` can acquire two mic streams and leak one

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/plugins/companion/useLocalDictation.ts:168-219
- **Scenario**: `start()` guards only on `if (listening) return`. `listening` only flips true AFTER `getUserMedia` resolves. During the permission-prompt window `listening` is still false, so a second trigger (double-tap the mic, or the orb + footer both driving capture) calls `start()` again: it sets `pendingStartRef.current = true` a second time and issues a second `getUserMedia`. Both resolve, the second `streamRef.current = stream` assignment overwrites the first, and the first `MediaStream` is never `.stop()`ed — a live mic left running with no ref to release it.
- **Root cause**: The in-flight guard uses `listening` (post-resolution) instead of the already-present `pendingStartRef` (which marks the in-flight window).
- **Impact**: Resource leak + privacy — an orphaned hot mic; also two overlapping ScriptProcessor graphs capturing into the same `chunksRef`.
- **Fix sketch**: Add `if (pendingStartRef.current) return;` at the top of `start()` alongside the `listening` guard.

## 3. `useIllustration` memoizes on the whole persona object, not the four fields its docstring claims

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/plugins/companion/inbox/hooks/useIllustration.ts:199-204
- **Scenario**: The hook's docstring says "Memoized on the four persona fields the resolver actually reads", but the implementation is `useMemo(() => resolveIllustration(persona), [persona])` — it depends on the whole object identity. Persona rows are routinely re-created (mapped/`{...p}` in render, refetched from IPC), so `persona` is a fresh reference each render and the memo never hits; `resolveIllustration` (which `JSON.parse`s `design_context` and scans keyword maps) re-runs on every render of every persona tile in the Cockpit grid.
- **Root cause**: Dependency array uses object identity while the doc/intent is field-level stability.
- **Impact**: Maintainability + perf — a promised memo that silently does nothing; wasted JSON.parse + keyword scans per render across a grid of tiles.
- **Fix sketch**: Depend on the read fields: `[persona.id, persona.name, persona.description, persona.icon, persona.design_context, persona.template_category]`.

## 4. OrbDecisionBubble position is computed from `window` dimensions with no resize recompute

- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/plugins/companion/orb/OrbDecisionBubble.tsx:139-151
- **Scenario**: `fallbackLeft/Top`, `dockedLeft`, and the `pos` style all read `window.innerWidth`/`innerHeight` at render time. The component only re-renders on store changes (decision/orb target/state). If the window is resized (or the Tauri webview is snapped) while a decision is pending and the orb hasn't reported a fresh `orbGuideTarget`, the bubble stays pinned to the old viewport math and can drift off-anchor or off-screen.
- **Root cause**: Viewport-derived positioning with no `resize` listener / no dependency on window size.
- **Impact**: UX — a pending decision bubble can misalign from the orb after a resize until an unrelated store update forces a re-render.
- **Fix sketch**: Subscribe to a `resize` listener (or a `useWindowSize`-style hook) to force a re-render, or position relative to the orb element via a ref/`ResizeObserver`.

## 5. KokoroVoicePanel and PocketVoicePanel duplicate the entire setup/install/preview scaffold

- **Lens**: code-refactor
- **Severity**: high
- **Category**: duplication
- **File**: src/features/plugins/companion/sub_voice/KokoroVoicePanel.tsx:141-514 · src/features/plugins/companion/sub_voice/PocketVoicePanel.tsx:377-787
- **Scenario**: `SetupRow` (installed/not-installed engine+model row with download link, copy-path, badges) is byte-for-byte identical between the two files (Kokoro:343-393, Pocket:609-659). `SetupCard`, `InstallBlock` (progress bar, `pct`/`isDownloading`/`failed` derivation, `phaseLabel` switch, `unlistenRef` subscribe/cleanup), and the per-voice preview state machine (`cleanup`/`onPreview` with `previewState` idle→synth→playing, Kokoro:409-447 / Pocket:676-714) are near-identical, differing only in the event constant, download command, and engine string. Verified by side-by-side read — same JSX, same class strings, same logic.
- **Root cause**: Two engine panels were authored by copy-paste rather than sharing a parameterized primitive.
- **Impact**: Maintainability — ~300 duplicated LOC; a fix to the install progress UI or preview cleanup must be made in ≥2 places (and a third if PiperVoicePanel follows the same shape).
- **Fix sketch**: Extract shared `<VoiceEngineSetupRow>`, `<VoiceEngineInstallBlock progressEvent=… download=… icon=…>`, and a `useVoicePreview(engine)` hook into `sub_voice/`; have both panels consume them.

## 6. Two identical sidebar-route allow-lists diverge waiting to happen

- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/plugins/companion/CompanionPanel.tsx:160-170 · src/features/plugins/companion/decision/useDecisionQueue.ts:55-65
- **Scenario**: `VALID_NAV_ROUTES` (CompanionPanel) and `VALID_ROUTES` (useDecisionQueue) are the same 9-element `SidebarSection[]` array, both documented as mirroring the backend `ALLOWED_ROUTES`. Both guard navigation from Athena-driven events. A backend allow-list change (add/remove a route) must be hand-synced in three places (both consts + Rust) with nothing forcing consistency.
- **Root cause**: The frontend mirror of the backend allow-list was copied into each consumer instead of shared.
- **Impact**: Maintainability / latent trust-boundary drift — one copy updated and the other not silently drops or admits a route in one surface only.
- **Fix sketch**: Export one `COMPANION_NAV_ROUTES` (e.g. from `athenaLabels.ts` or a small `companionRoutes.ts`) and import it in both; ideally assert it against the generated backend binding.

## 7. Dead no-op ternary drops the separator between consolidation sources

- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/plugins/companion/sub_memory/ConsolidationReview.tsx:475-480
- **Scenario**: Sources render as `{s}{i < item.sources.length - 1 ? '' : ''}` — both ternary branches are the empty string, so the expression is inert leftover (clearly meant to emit a `, ` separator on all-but-last). Multiple sources therefore render as adjacent `<code>` chips with no delimiter.
- **Root cause**: A separator was stubbed out (or half-removed) and left as a no-op ternary.
- **Impact**: Maintainability + minor UX — confusing dead branch; source ids visually run together.
- **Fix sketch**: Replace with `{i < item.sources.length - 1 ? ', ' : ''}` or drop the ternary and gap the chips with CSS.

## 8. `formatRelativeTime` re-implements the shared RelativeTime formatter

- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/plugins/companion/sub_memory/ConsolidationReview.tsx:532-544
- **Scenario**: This file hand-rolls a `formatRelativeTime(iso)` ("just now" / "Nm ago" / "Nh ago" / "Nd ago" → `toLocaleDateString`). The codebase already ships a shared `RelativeTime` display component (used in BrainViewer.tsx:362 and elsewhere) plus the same NaN-guard pattern (`Number.isNaN(Date.parse(...))`). The local copy also emits non-i18n English strings ("just now") inside an otherwise fully-translated surface.
- **Root cause**: Local relative-time formatting instead of reusing the shared primitive.
- **Impact**: Maintainability + i18n inconsistency — a second relative-time implementation with untranslated literals.
- **Fix sketch**: Render `<RelativeTime timestamp={run.triggeredAt} />` (as ListView already does) and delete the local helper.

## 9. Per-voice audio-preview state machine duplicated across voice rows

- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/plugins/companion/sub_voice/PocketVoicePanel.tsx:669-714 · src/features/plugins/companion/sub_voice/KokoroVoicePanel.tsx:402-447
- **Scenario**: `PocketVoiceRow` and `KokoroVoiceRow` each carry the identical `previewState`('idle'|'synth'|'playing') + `audioRef`/`urlRef` + `cleanup` (pause + `revokeObjectURL`) + `onPreview` (toggle-stop, synth, play, catch) block, differing only in the engine arg passed to `synthesize`. Same blob-URL lifecycle and `useEffect(() => cleanup, [cleanup])` teardown in both.
- **Root cause**: Copy-paste of the preview affordance per engine row.
- **Impact**: Maintainability — a blob-URL leak fix or preview-UX change must be applied in every voice row (overlaps finding #5).
- **Fix sketch**: Extract `useVoicePreview(text, voiceId, settings, engine)` returning `{ previewState, onPreview }`, and share a `<PreviewButton>`; consume in both rows (and PiperVoiceRow).
