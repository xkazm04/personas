# overview/shared — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 1 medium / 2 low)
> Context group: Observability & Monitoring | Files read: 8 | Missing: 0

## 1. STATUS_ICONS duplicates eventTokens' status→icon map with drifted icons/colors
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/shared/eventVisuals.ts:32
- **Scenario**: `eventVisuals.STATUS_ICONS` / `resolveStatusIcon()` (used by EventLogSidebar, EventDetailDrawer) maps the same event statuses as the design-token map `EVENT_STATUS_ICONS` / `getEventStatusIcon()` in `src/lib/design/eventTokens.ts:131-144`, but with different glyphs and hardcoded palette colors: failed = AlertCircle/`text-red-400` here vs XCircle/`text-status-error` there; skipped = ChevronDown (a disclosure chevron, semantically wrong for a status) vs MinusCircle. A third ad-hoc local `STATUS_ICONS` exists in `src/features/agents/sub_lab/use-cases/UseCaseHistory.tsx:12` (cross-context; verify before touching).
- **Root cause**: eventVisuals.ts was written as an overview-local visual map before/despite the canonical status token layer in `lib/design/eventTokens.ts`, and never reconciled.
- **Impact**: The same event status renders with different icon shapes and colors depending on which panel the user looks at, and eventVisuals bypasses the `--status-*` design tokens (raw `text-red-400`/`text-emerald-400`), so token/theming updates silently miss the realtime panels. Adding a status means editing 2-3 maps.
- **Fix sketch**: Make `STATUS_ICONS` in eventVisuals a thin projection over `EVENT_STATUS_ICONS` + `EVENT_STATUS_COLORS` from eventTokens (it already imports from `@/lib/design/statusTokens`), keeping only the genuinely local `processed` alias (map it to `completed`). Replace ChevronDown/`text-foreground` for skipped with the canonical MinusCircle/status-neutral. Leave UseCaseHistory for a follow-up since its status vocabulary (queued) differs.

## 2. Dead accent/content fields: `EmptyStateAccent.text` unused, `EmptyStateContent.icon` required but never rendered
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/shared/emptyStatePrototype/types.ts:33
- **Scenario**: Grep across src/ shows no reader of `MOTIF_ACCENTS[*].text` (the only `accent.text` hits belong to unrelated accent objects in sidebar/triggers). Likewise `EmptyStateContent.icon` (types.ts:48) is a *required* field whose doc comment claims it's "used by Illustration placeholder + as a small badge", but neither `IllustrationEmptyState`, `MotionEmptyState`, nor `parts.tsx` ever reads `content.icon`.
- **Root cause**: Leftovers from the /prototype run (2026-05-24): the placeholder/badge rendering was removed when the Leonardo heroes landed, but the type contract and per-motif `text` classes were kept.
- **Impact**: All six consuming modules are forced to import and pass a lucide icon that is silently dropped; the six `text-*` class strings in MOTIF_ACCENTS are noise that suggests a styling hook which doesn't exist. Pure maintenance drag, no runtime cost.
- **Fix sketch**: Delete `text` from `EmptyStateAccent` and each `MOTIF_ACCENTS` entry; make `icon` optional or remove it and drop the now-unused lucide imports at the six call sites (EmptyStates.tsx, MessageList.tsx, ReviewFocusFlow.tsx, KnowledgeGraphDashboard.tsx, GlobalExecutionList.tsx, ManualReviewList.tsx). Fix the stale doc comment either way. Verify with tsc after removal.

## 3. EVENT_TYPE_HEX_COLORS re-exported from two unrelated barrels, consumers split across three import paths
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/overview/shared/eventVisuals.ts:17
- **Scenario**: `EVENT_TYPE_HEX_COLORS` lives in `@/lib/design/eventTokens` but is re-exported both here and in `src/hooks/realtime/useRealtimeEvents.ts:10`. Realtime views/renderers import it from the hooks module, EventLogSidebar/EventDetailDrawer from eventVisuals, EventBusFilterBar from the hooks module — three paths to one constant.
- **Root cause**: Two convenience re-exports were added independently instead of consumers importing from the design-token source.
- **Impact**: Go-to-definition and grep hit indirection layers; a data hook (`useRealtimeEvents`) exporting a color table is a misleading dependency edge. No runtime cost.
- **Fix sketch**: Delete both re-export lines and point the ~7 consumers at `@/lib/design/eventTokens` directly. Mechanical change, tsc-verifiable.
