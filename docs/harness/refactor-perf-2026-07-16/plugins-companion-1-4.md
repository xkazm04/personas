# plugins/companion [1/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Plugins & Companion | Files read: 34 | Missing: 0

## 1. Brain Viewer type cards fetch the FULL item list for all 13 memory kinds just to show counts
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/plugins/companion/BrainViewer.tsx:260-273
- **Scenario**: Every time the Brain Viewer opens at its root (chat toolbar brain button, or a recall-chip drill-back to the type picker), `TypesView` fires 13 parallel `companionListBrainItems(kind)` IPCs and does `items.length` on each result — discarding every row it just paid to serialize. Episodes/reflections lists carry `title + meta + preview` per row and grow with the entire conversation/reflection history.
- **Root cause**: No count endpoint; the list command is being used as a counter, so payload scales with total memory size × 13 kinds on a purely cosmetic "N items" label.
- **Impact**: On a mature brain (hundreds of episodes), opening the type picker deserializes hundreds of rows across the Tauri IPC boundary for numbers that could be a single `SELECT kind, COUNT(*)`. Latency on the "…" placeholders grows linearly with brain size; the same lists are re-fetched again when the user actually clicks into a kind (`ListView`).
- **Fix sketch**: Add a `companion_count_brain_items` Rust command that runs one grouped `COUNT(*)` (or per-kind counts for the file-backed kinds) and returns a `Record<BrainKind, number>` in a single IPC. `TypesView` then does one call instead of 13, and `setCounts` fires once. Keep `companionListBrainItems` for `ListView` only.

## 2. `InstallBlock` + `SetupRow` duplicated wholesale between KokoroVoicePanel and PocketVoicePanel
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/companion/sub_voice/PocketVoicePanel.tsx:445-659
- **Scenario**: `KokoroVoicePanel.tsx:212-393` and `PocketVoicePanel.tsx:445-659` each define a private `InstallBlock` (event subscription, `phaseLabel` switch, pct math, progress bar, failed-state rendering) and a private `SetupRow` (identical `SetupRowProps` interface, identical JSX apart from one icon). The Pocket copy even reuses the Kokoro i18n keys (`voice_kokoro_install_engine`, etc.), proving the logic is engine-agnostic.
- **Root cause**: Pocket panel was cloned from the Kokoro panel (the doc comment says "Mirrors the Kokoro InstallBlock") and the shared pieces were never extracted. `KokoroInstallProgress` and `PocketInstallProgress` share the same `{phase, bytesDownloaded, bytesTotal, error}` shape, so nothing structural blocks consolidation.
- **Impact**: ~250 duplicated LOC; every install-flow fix (e.g. the queued-forever guard, progress-bar styling, a new phase) must be applied twice and has already started drifting (Sparkles vs AudioWaveform icon is the only intended difference). The two preview-row components (`KokoroVoiceRow`/`PocketVoiceRow`) duplicate the synth-preview state machine as well.
- **Fix sketch**: Extract `sub_voice/shared/EngineInstallBlock.tsx` taking `{eventName, onDownload, title, description, icon}` and a `sub_voice/shared/EngineSetupRow.tsx` with the existing props. Optionally extract a `useVoicePreview(engine, voiceId)` hook for the shared synth→play→cleanup preview state machine used by both voice rows. Pure component moves; no behavior change.

## 3. Sidebar route allow-list and `applyClientAction` triplicated across companion surfaces
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/companion/ApprovalCard.tsx:19-78
- **Scenario**: The same 9-entry `SidebarSection` allow-list is hand-maintained in three places: `CompanionPanel.tsx:160` (`VALID_NAV_ROUTES`), `decision/useDecisionQueue.ts:55` (`VALID_ROUTES`), and `ApprovalCard.tsx:19` (`VALID_ROUTES`). `applyClientAction` also exists twice — a full version in ApprovalCard (navigate/prefill/open_companion_tab/open_external_url) and a navigate-only fork in useDecisionQueue with a comment acknowledging the split.
- **Root cause**: Each surface copied the defensive mirror of the backend `ALLOWED_ROUTES` rather than importing one shared constant/handler.
- **Impact**: Adding a new sidebar section requires touching three lists; missing one means a decision-bubble approval that navigates silently no-ops while the same approval in the chat panel works (behavioral divergence between the two approval UIs). The hands-free queue already can't honor `prefill`/`open_companion_tab` outcomes because it uses the reduced fork.
- **Fix sketch**: Create `companion/clientActions.ts` exporting `VALID_NAV_ROUTES` and the full `applyClientAction`. Import it in all three files; delete the local copies. useDecisionQueue's approval resolve then handles every ClientAction kind for free.

## 4. Decision-queue pump does 3 sequential IPCs and materializes the whole queue to use one element
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src/features/plugins/companion/decision/useDecisionQueue.ts:360-439
- **Scenario**: With hands-free decisions or autonomous mode on, `pump()` runs on every `companion://approvals` event, every `companion://proactive` event, and every decision resolution. Each pump awaits `companionListPendingApprovals()`, then `companionListProactiveMessages(true)` (unbounded — no limit arg, unlike the panel's `20`), then `listManualReviews(undefined, 'pending')` strictly in sequence, converts every row into a full `PendingDecision` (per-row `JSON.stringify` payloads, closures), and then uses only `queue[0]`.
- **Root cause**: `buildQueue` was written as "assemble the FIFO" but the consumer is "give me the head"; the three independent fetches were chained instead of parallelized.
- **Impact**: Time-to-bubble is the sum of three IPC round-trips instead of the max; in autonomous mode (frequent approval mints) this triple-fetch fires repeatedly, and the proactive fetch has no cap so its payload grows with unresolved-nudge history. Wasted work is proportional to pending-item count on every event.
- **Fix sketch**: `Promise.all` the three list calls; pass a limit to `companionListProactiveMessages`. Pick the head row first (approvals[0] → first incident → first attention → reviews[0]) and only convert that one row into a `PendingDecision`. The pumping ref already serializes overlaps, so no other changes needed.

## 5. PROGRESS-beat detector re-splits the entire streamingText on every animation-frame flush
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: algorithms
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1731-1749
- **Scenario**: During a token-streamed turn, the delta buffer flushes once per animation frame, growing `streamingText`; the beat effect then does `streamingText.split('\n')` plus a regex over every completed line — on the full accumulated text, every frame. A long reply (tens of KB over 30-60s of streaming) makes this O(n²) over the turn: total work grows with (reply length × flush count).
- **Root cause**: The effect re-derives all beats from scratch and compares against `progressFiredRef.current` (a count) instead of scanning only the text appended since the last processed offset.
- **Impact**: Main-thread work per frame scales with reply length while the user is watching the most latency-sensitive surface in the app (the live bubble). Allocations from `split` on a large string every frame add GC pressure on top of the per-frame store write.
- **Fix sketch**: Keep a `scannedOffsetRef`; on each run, take `streamingText.slice(scannedOffsetRef.current)`, find the last `\n`, scan only the completed lines in that window for `PROGRESS:` matches, and advance the offset. Reset the offset in the same places `progressFiredRef` resets (turn start / not-streaming).

## 6. ConsolidationReview hand-rolls an untranslated relative-time formatter instead of the shared `RelativeTime`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/companion/sub_memory/ConsolidationReview.tsx:532-544
- **Scenario**: The runs list renders `formatRelativeTime(run.triggeredAt)` — a private helper with hardcoded English strings ('just now', '3m ago') — while sibling companion surfaces (BrainViewer list rows, DevOpLedger, Bubble meta, DecisionsPanel) all use the shared `RelativeTime` component from `@/features/shared/components/display/RelativeTime`. Line 165 also hardcodes the English "episodes reviewed" fallback outside i18n.
- **Root cause**: Local convenience helper written before (or in ignorance of) the shared component; never migrated.
- **Impact**: Third relative-time implementation in this one context (the shared component, `SensorySignalsModal.formatAge`, and this one); this copy bypasses i18n entirely, so it will surface English strings in translated builds, and it renders a static snapshot rather than the live-updating label the shared component gives everywhere else.
- **Fix sketch**: Replace the call with `<RelativeTime timestamp={run.triggeredAt} />` and delete `formatRelativeTime`. Move the "episodes reviewed" fallback into an i18n key while touching the line. (`SensorySignalsModal.formatAge` is i18n'd and second-granular, so leave it.)
