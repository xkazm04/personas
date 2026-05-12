# Code-refactor scan — Activity, Events & Realtime Bus

> Total: 12 findings (4 high, 6 medium, 2 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: significant — none of the context's listed `src/features/{activity,events,realtime}`, `src/api/{activity,events,realtime}.ts`, `src/lib/{events,realtime,eventBus}`, `src/stores/slices/{activitySlice,eventSlice,realtimeSlice}.ts`, `src-tauri/src/commands/{activity,events,realtime}.rs`, `src-tauri/src/db/models/activity.rs`, `src-tauri/src/lib/*`, or `src-tauri/src/db/repos/{activity,events}` exist. Actual locations: `src/features/overview/{sub_activity,sub_events,sub_realtime}/`, `src/api/overview/events.ts`, `src/api/events/sharedEvents.ts`, `src/lib/{eventBridge,eventRegistry,eventTypeTaxonomy}.ts`, `src/stores/slices/{overview/eventSlice,processActivitySlice}.ts`, `src/hooks/realtime/*`, `src-tauri/src/commands/communication/{events,shared_events}.rs`, `src-tauri/src/db/repos/communication/{events,shared_events}.rs`, `src-tauri/src/db/models/{event,shared_event}.rs`, `src-tauri/src/engine/event_registry.rs`.

## 1. Three near-duplicate `HighlightedJson` JSON syntax-highlighter implementations
- **Severity**: high
- **Category**: duplication
- **File**: `src/features/overview/sub_events/HighlightedJson.tsx:1`, `src/features/triggers/sub_live_stream/HighlightedJson.tsx:1`, `src/features/overview/sub_events/components/EventLogItem.tsx:15-53` (inline 4th copy)
- **Scenario**: Three independent `HighlightedJson` components each implement a hand-rolled token regex JSON colorizer (`colorizeJson`/`tokenize`) with virtually identical 80-line shapes — sub_events version (sky-400 keys / emerald strings / amber numbers / violet bools), live_stream version (cyan-400 keys / same other colors + null/punct tokens), inline EventLogItem copy (identical to sub_events but without the splitIntoLines pass + copy button). A fourth `HighlightedJsonBlock` at `src/features/agents/sub_executions/detail/inspector/HighlightedJsonBlock.tsx:8` uses `highlight.js` instead — the only one with sanitization.
- **Root cause**: Each consumer copy-pasted the parser instead of importing. `HighlightedJsonBlock` (hljs-based) is the only sanitization-safe variant; the regex variants render untrusted JSON inside `<pre>` text nodes so they're not XSS bugs, but they diverge in token coverage (live_stream tokenizes null/punctuation; sub_events does not).
- **Impact**: ~210 LOC of triplicated parser logic; any styling/feature change (e.g. fold long arrays) must touch 3 files; visual inconsistency between event modal variants.
- **Fix sketch**: Promote `sub_events/HighlightedJson.tsx` (with the lines/copy button) to `src/features/shared/components/display/HighlightedJson.tsx`, delete the live_stream copy and the inline EventLogItem version. Consider standardizing on `HighlightedJsonBlock`'s hljs-based approach since it already has sanitization (`sanitizeHljsHtml`) — the regex versions are reinventing the wheel.

## 2. Three `EventDetailModal`-equivalent components rendering the same fields
- **Severity**: high
- **Category**: duplication
- **File**: `src/features/overview/sub_events/EventDetailModal.tsx:12-71`, `src/features/triggers/sub_live_stream/EventDetailModal.tsx:23-172`, `src/features/overview/sub_realtime/components/panels/EventDetailDrawer.tsx:23-113`, plus inline `EventDetailContent` in `src/features/overview/sub_events/components/EventLogItem.tsx:63-133`
- **Scenario**: Four components show the same persona-event detail panel (id / project / source / target / processed_at + payload + error_message), each with a different wrapper (DetailModal, BaseModal, bottom drawer). `EventDetailContent` (sub_events/components/EventLogItem.tsx:63) is the only one actually invoked from `EventLogList.tsx:431`; the standalone `sub_events/EventDetailModal.tsx` wrapper is imported only by `src/features/agents/sub_activity/ActivityModals.tsx:12`.
- **Root cause**: As the realtime visualizer and triggers tab grew, each surface duplicated the event-detail layout instead of accepting a "presenter" prop on a single component. The grid-of-meta-cells + payload-pre + error-pre pattern repeats 4 times.
- **Impact**: ~370 LOC across 4 files. Adding a new field (e.g. retry_count) means 4 edits; a11y/i18n drift already present (live_stream uses BaseModal with focus trap; sub_events uses DetailModal; realtime uses raw div).
- **Fix sketch**: Extract `EventDetailBody({ event })` as the single rendering primitive (the meta-grid + payload + error), then have `EventDetailModal` / `EventDetailDrawer` be thin layout shells around it. Delete the inline copy in EventLogItem and the wrapper in sub_events/EventDetailModal.tsx.

## 3. Orphaned visualizer renderer modules `VisualizationNodes` / `VisualizationParticles` (156 LOC dead)
- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/overview/sub_realtime/components/renderers/VisualizationNodes.tsx:1-80`, `src/features/overview/sub_realtime/components/renderers/VisualizationParticles.tsx:1-76`
- **Scenario**: Both modules export `ToolNodeGroup`/`PersonaNodeGroup` and particle-trail components, but no file in the repo imports `VisualizationNodes` or `VisualizationParticles`. They appear to be predecessors to the now-live `EventBusNodeRenderers` (`OuterNodeGroup`/`InnerNodeGroup`) and `EventBusParticleRenderers` (`InboundCometTrails`/`ReturnFlowComets`) which sit in the same directory.
- **Root cause**: The visualizer was refactored to a polygon-based diamond geometry (`EventBusNodeRenderers`) but the older circle-based ring renderers were never deleted.
- **Impact**: 156 LOC dead, confusing for anyone reading the renderers/ directory.
- **Fix sketch**: Delete both files outright. Verify no test imports them.

## 4. `parseEventQuery` + `matchesQuery` query DSL is completely orphan (132 LOC)
- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/overview/sub_realtime/libs/parseEventQuery.ts:1-131`
- **Scenario**: A 132-line structured-query parser supporting `field:value`, `/regex/`, free-text, with `matchesQuery()` for AND-matching. The header docstring claims "Mini structured-query parser for the EventLogSidebar" — but `EventLogSidebar.tsx:69-79` filters via a 5-line inline `toLowerCase().includes()` loop and never imports `parseEventQuery` or `matchesQuery`. Grep across `src/` shows zero importers outside its own file.
- **Root cause**: Feature built ahead of the consumer that was meant to call it; the sidebar shipped with a simpler filter and the DSL was never wired in.
- **Impact**: 132 LOC unreachable; future readers may believe the sidebar supports DSL syntax and will not.
- **Fix sketch**: Either delete the file, OR wire it into `EventLogSidebar.tsx`'s `filteredLog` memo. Given that `useEventBusFilter`+`applyFilter` (eventBusFilterTypes.ts) is the active filter path for the visualizer page, deletion is cleaner.

## 5. `RealtimeEvent` is a near-duplicate of generated `PersonaEvent` binding
- **Severity**: medium
- **Category**: duplication
- **File**: `src/hooks/realtime/useRealtimeEvents.ts:16-28`
- **Scenario**: `RealtimeEvent` is hand-declared with 11 fields that exactly match `PersonaEvent` from `src/lib/bindings/PersonaEvent.ts:4` minus `use_case_id` and `retry_count`. The handler then casts: `pushEvent(raw as RealtimeEvent)` (line 182) — silently dropping the two extra fields. Every consumer (`EventBusVisualization`, `SwimLaneVisualization`, `EventDetailDrawer`, `EventLogSidebar`, `useEventBusFilter`) imports `RealtimeEvent`.
- **Root cause**: `PersonaEvent` predates `use_case_id`/`retry_count` columns; when ts-rs added them, the hook authors didn't want to deal with them in the visualizer so they declared a local subset type.
- **Impact**: Type drift bug-magnet — any new field on `PersonaEvent` is invisible to the visualizer; the cast at line 182 will silently keep working. ~6 consumers ship a phantom type.
- **Fix sketch**: Replace `interface RealtimeEvent` with `type RealtimeEvent = PersonaEvent` (or `Omit<PersonaEvent, 'use_case_id' | 'retry_count'>` if the slim shape is load-bearing). Remove the unsafe cast at line 182.

## 6. Two `HighlightedJson`/`EventDetailContent` exports in EventLogItem.tsx but only one is consumed
- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/overview/sub_events/components/EventLogItem.tsx:38-53` (HighlightedJson), `:148-205` (EventRow), `:217-266` (EventGridRow)
- **Scenario**: `EventLogItem.tsx` exports `HighlightedJson`, `EventDetailContent`, `EventRow`, and `EventGridRow`. Grep shows only `EventDetailContent` is imported (from `EventLogList.tsx:17`). `EventRow` and `EventGridRow` (table-row + grid-row variants of the same layout, ~119 LOC together) have no consumers. The local `HighlightedJson` is also unused — only the sibling `sub_events/HighlightedJson.tsx` is imported by `EventDetailModal.tsx`.
- **Root cause**: The list was virtualized via `UnifiedTable` (see `EventLogList.tsx:395`), which renders inline cells via `columns` config — the manual `EventRow`/`EventGridRow` components were left behind from a prior virtualization attempt.
- **Impact**: ~150 LOC dead in a heavily-edited file; readers see two row implementations and wonder which is canonical.
- **Fix sketch**: Delete `HighlightedJson`, `EventRow`, `EventGridRow` from `EventLogItem.tsx`. Reduce the file to just `EventDetailContent` (or fold that into `EventLogList.tsx` since it's the sole consumer).

## 7. `defaultStatus` literal duplicated in 4 sites
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_events/components/EventLogItem.tsx:146`, `src/features/overview/sub_events/components/EventLogList.tsx:24`, `src/features/triggers/sub_live_stream/EventDetailModal.tsx:21`, `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:21`
- **Scenario**: Identical `const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };` appears in 4 files, always paired with `EVENT_STATUS_COLORS[event.status] ?? defaultStatus`. `EVENT_STATUS_COLORS` itself is centralized in `src/lib/design/eventTokens.ts:106` — the fallback should be too.
- **Root cause**: Copy-paste; the fallback was never elevated to the token module.
- **Impact**: 4 sites must change together if the unknown-status color is rebrandable.
- **Fix sketch**: Add `EVENT_STATUS_FALLBACK` to `src/lib/design/eventTokens.ts` (it's already re-exported via `formatters.ts:170`), then replace the 4 inline objects with imports + `getEventStatusColor(event.status)` which already handles fallback internally.

## 8. `BusLane` and `EventParticle` exported from sub_realtime index but never imported
- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/overview/sub_realtime/components/renderers/BusLane.tsx:1-93`, `src/features/overview/sub_realtime/components/renderers/EventParticle.tsx:1-62`, re-exported at `src/features/overview/sub_realtime/index.ts:9-10`
- **Scenario**: Both are `memo()`-wrapped components with the only references in their own files plus the barrel `index.ts`. Grep across `src/` finds no other importers. The live visualizer (`EventBusVisualization.tsx`) renders via `InboundCometTrails`/`ReturnFlowComets`/`EventBusSvgScene` instead.
- **Root cause**: Predecessors to the comet-trail particle system; never deleted after the upgrade.
- **Impact**: 155 LOC dead + misleading public surface (the barrel makes them look canonical).
- **Fix sketch**: Delete both files and remove lines 9-10 from `sub_realtime/index.ts`.

## 9. `RealtimeWelcomeOverlay` component is orphan (80 LOC)
- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/overview/sub_realtime/components/views/RealtimeWelcomeOverlay.tsx:1-80`
- **Scenario**: Exports `RealtimeWelcomeOverlay({ onTestFlow })` with a 60-line inline-SVG ParticleFlowPreview. Grep shows no importers — `RealtimeVisualizerPage.tsx` does not reference it; `EventBusVisualization.tsx` shows its own welcome state inline.
- **Root cause**: Earlier design replaced before the file was removed.
- **Impact**: 80 LOC dead.
- **Fix sketch**: Delete file. If the SVG is wanted as a brand asset, move the `<ParticleFlowPreview>` to a shared illustrations module.

## 10. `executionMetricsHelpers.ts` `fmtCost` duplicated across 4 modules
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_activity/libs/executionMetricsHelpers.ts:1-2`, `src/features/agents/sub_lab/libs/reportGenerator.ts:47`, `src/features/agents/sub_executions/libs/comparisonHelpers.ts:27`, `src/features/agents/sub_executions/components/runner/ExecutionPreviewPanel.tsx:12`
- **Scenario**: `fmtCost(v)` with the same `<$0.01` low-bound + `$X.XX` shape is implemented 4 times. `fmtDate` is also duplicated between `executionMetricsHelpers.ts:4` and `reportGenerator.ts:55` (different signatures: one takes `YYYY-MM-DD`, the other an ISO string — but same locale-string output).
- **Root cause**: Each subfeature created its own micro-formatter rather than extending `src/lib/utils/formatters.ts`.
- **Impact**: 4 cost-formatter copies, 2 date-formatter copies. Rounding/locale rules diverge silently.
- **Fix sketch**: Promote `fmtCost` to `src/lib/utils/formatters.ts` alongside `formatDuration`. Replace 4 callsites with the import. For `fmtDate`, fold both variants into a single `formatShortDate(input: string | Date)` that handles both.

## 11. `sub_events/index.ts` exports default + named for the same component
- **Severity**: low
- **Category**: cruft
- **File**: `src/features/overview/sub_events/index.ts:1-3`, `src/features/overview/sub_activity/index.ts:1-2`
- **Scenario**:
  ```
  export { default as EventLogList } from './components/EventLogList';
  export { default } from './components/EventLogList';
  ```
  Same pattern in `sub_activity/index.ts` for `GlobalExecutionList`. The `export { default }` line is unused — no caller does `import EventLogList from '@/features/overview/sub_events'` (verified via grep).
- **Root cause**: Defensive export added during a barrel refactor.
- **Impact**: Cruft; trips up tree-shakers on tools that don't dedupe identical re-exports.
- **Fix sketch**: Drop the `export { default }` lines; keep the named export.

## 12. `seedMockEvent` exposed in API client but only one call site
- **Severity**: low
- **Category**: cruft
- **File**: `src/api/overview/events.ts:50-51`, command at `src-tauri/src/commands/communication/events.rs:251-293`
- **Scenario**: `seedMockEvent` (and its 43-line Rust counterpart `seed_mock_event`) is callable from production code (`EventLogList.tsx:107`) via a "Seed Mock Event" button. The Rust command requires `require_auth_sync` but is otherwise un-gated by build flag — `mock_seed.rs` ships in release builds. Not strictly dead, but it's a dev-only affordance permanently exposed.
- **Root cause**: Useful during development; never gated behind a feature flag.
- **Impact**: Surface area for prod users to inject synthetic events.
- **Fix sketch**: Gate the Rust `seed_mock_event` command + its `mock_seed` module behind `#[cfg(debug_assertions)]` (or a `dev-tools` feature flag), and conditionally hide the UI button. Low priority since the button is already labeled "Mock Event".
