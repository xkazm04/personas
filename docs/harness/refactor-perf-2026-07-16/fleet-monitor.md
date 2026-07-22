# fleet/monitor — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Observability & Monitoring | Files read: 20 | Missing: 3

Missing files (skipped): `channels/ChannelTimelineWorkspace.tsx`, `channels/VirtualStream.tsx`, `channels/feedFilter.ts`.

## 1. useMonitorData is double-mounted by the Quick Answer popover — every poll cycle runs twice (thrice with the Monitor open)
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: duplicate-polling
- **File**: src/features/fleet/monitor/useMonitorData.ts:62 (mounts: src/features/agents/quick-answer/QuickAnswerPopover.tsx:24 and src/features/agents/quick-answer/QuickAnswerBody.tsx:33)
- **Scenario**: `useMonitorData` is a self-contained hook holding its own `useState` plus four `usePolling` loops (`listManualReviews`, `listMessages(300)`, `fetchPersonaSummaries`, `fetchCloudReviews`). `QuickAnswerPopover` calls `usePendingInteractions()` (which wraps `useMonitorData`) just for the header `total`, and then renders `QuickAnswerBody`, which calls `usePendingInteractions()` again. Two independent hook instances → every initial fetch and every poll interval fires twice while the popover is open. If the user then opens the full PersonaMonitor (which also mounts `useMonitorData`), it's three concurrent pollers.
- **Root cause**: The data layer lives in per-mount hook state instead of a shared store (or a single mount point), and the popover pulls the whole data hook to read one derived count.
- **Impact**: 2–3× duplicated Tauri IPC + SQLite queries (including a 300-row message scan) on every dashboard-refresh tick, plus duplicated cloud-review polls when connected. Also a drift hazard: two instances can show different `isProcessing`/review states for the same underlying data.
- **Fix sketch**: Lift `usePendingInteractions` to a single mount: have `QuickAnswerPopover` call it once and pass the data (or at least `total`) down to `QuickAnswerBody` as props — `QuickAnswerBody`'s only other host would need the same treatment. Longer term, move reviews/unread-messages into a store slice with refcounted subscription (the pattern `channelSlice` already established for team channels, see mergedFeed.tsx header comment) so N consumers share one poll.

## 2. useMergedChannels computes presence and per-team maps its only consumer throws away
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: wasted-computation
- **File**: src/features/fleet/monitor/channels/mergedFeed.tsx:38
- **Scenario**: Per the file's own P2 note, the Stream no longer uses this feed — the ONLY consumer is `LiveChannelOverlay`, which destructures just `merged` (LiveChannelOverlay.tsx:160). Yet on every `channels` store update (15s poll per team + live events, app-root mounted whenever `monitorLiveMode` is on) the memo runs `derivePresence(items)` over every team's full cached item list and builds the `byTeam` row map, then both are discarded.
- **Root cause**: The hook's return shape still serves the retired multi-consumer design; the surviving consumer needs only the bounded newest-first window.
- **Impact**: O(sum of all cached channel items) scans repeated on every channel poll tick for the lifetime of the app while live mode is enabled — pure waste, and it grows with channel history and team count.
- **Fix sketch**: Slim the hook to return only `merged` (tag + sort + `LIVE_FEED_WINDOW` slice). Delete `presenceByTeam`/`byTeam` from the return and the `PresenceMap` plumbing in types.ts if nothing else imports it. If presence is ever needed again, compute it in the component that wants it (ConversationSidebar already calls `derivePresence` directly).

## 3. MergedChannels render-prop wrapper + LiveFeedSink null-component are legacy indirection around a plain hook call
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/fleet/monitor/channels/mergedFeed.tsx:52 (consumer: src/features/fleet/monitor/live/LiveChannelOverlay.tsx:29,159)
- **Scenario**: `MergedChannels` is documented as "kept so existing callers didn't have to change", but grep shows exactly one caller left: `LiveChannelOverlay`. To consume it, the overlay defines `LiveFeedSink`, a component that renders `null` and exists solely to host a `useEffect` inside the render-prop.
- **Root cause**: The render-prop wrapper survived the P2 migration that removed every other consumer; the sink component is scar tissue compensating for it.
- **Impact**: ~40 lines of indirection across two files for what is one hook call + one effect; the conditional `{feedTeams.length > 0 && <MergedChannels …>}` also means the diff-sink's `seen`/`established` refs reset whenever teams momentarily empty, which is subtle state hidden by the structure.
- **Fix sketch**: Delete `MergedChannels` and `LiveFeedSink`; call `const { merged } = useMergedChannels(feedTeams)` directly in `LiveChannelOverlay` (the hook already no-ops on an empty team list via `useChannelSubscription`) and inline the diff effect. Combines naturally with finding #2's return-shape slimming.

## 4. EXEC_STATE_META is an unused export superseded by PILLAR_VISUAL_BY_KEY
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/fleet/monitor/monitorModel.ts:102
- **Scenario**: `EXEC_STATE_META` (card background/border classes + pulse per `ExecState`) has zero references outside its definition — repo-wide grep finds no consumer, not even monitorModel.test.ts. Card visuals are now driven by the v2 `PILLAR_VISUAL_BY_KEY`/`pillarVisual` path.
- **Root cause**: The v2 pillar visuals replaced the v1 card-colour table but the old table (and its `ExecStateMeta` interface) was left exported.
- **Impact**: ~25 lines of dead styling in the monitor's core model file; a future editor tweaking card colours can plausibly edit the wrong table and see nothing change.
- **Fix sketch**: Delete `EXEC_STATE_META` and the `ExecStateMeta` interface (keep `ExecState` itself — it's a live field on `PersonaCardModel`). One `tsc` run confirms no dynamic use; nothing in this repo imports it.

## 5. Author-tint and name-cleaning logic duplicated across MergedRow, liveModel, and fleetGridModel
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/fleet/monitor/channels/MergedRow.tsx:69
- **Scenario**: Three copies of the same presentation rules drift independently: (a) `MergedRow`'s inline `avatarBg` kind→tint ladder (athena/director/directive/default) duplicates `avatarTint()` in live/liveModel.tsx:53; (b) the `SDLC` prefix-strip regex `/^SDLC[ —-]*/i` exists both in fleetGridModel.ts:57 (`cleanName`) and inline at MergedRow.tsx:86; (c) liveModel.tsx:131 strips `/^T: /` while `cleanName` strips `/^T:\s*/` — already subtly inconsistent (a `T:` without a trailing space is cleaned in the grid but not in pop-ups).
- **Root cause**: The live overlay was extracted from the channel row (liveModel even cites `MergedRow.resolveCompact` as canonical) but the small visual helpers were re-implemented instead of shared.
- **Impact**: Timeline rows, corner pop-ups, and grid tiles can silently disagree on author colour and display name; every future author-kind addition must be made in two or three places.
- **Fix sketch**: Have `MergedRow` import `avatarTint` from liveModel (or move both `resolveCompact` and the tint map into a small shared `channels/authorVisuals.ts` to fix the current channels→live→channels import cycle-in-spirit). Move `cleanName` to a shared name util and reuse it in MergedRow's team label and liveModel's `projectChannelItem`, aligning the `T:` regex to `\s*`.
