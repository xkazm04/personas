# plugins/fleet [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 0 medium / 2 low)
> Context group: Plugins & Companion | Files read: 9 | Missing: 0

## 1. Dead preview tier: `FleetTilePreview` + `useFleetTilePreviews` + `terminalPreviews` IPC path unused anywhere
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/fleet/FleetTilePreview.tsx:17 (plus src/features/plugins/fleet/useFleetTilePreviews.ts:27, src/api/fleet/fleet.ts:75)
- **Scenario**: A repo-wide grep finds zero imports of `FleetTilePreview`, `useFleetTilePreviews`, or the `terminalPreviews` API wrapper outside their own definitions and docs. The grid overlay (`FleetTerminalOverlay.tsx`) now renders `FleetOverlayTile` with either a live terminal or a "cheap status block" — the cooked-lines preview tier was superseded and never wired in.
- **Root cause**: The render-policy redesign (live-on-attention + status blocks, documented at FleetTerminalOverlay.tsx:97-101) replaced the polled-preview tier, but the component, its 111-line batched polling hook, the `terminalPreviews` frontend API, and (per the 2026-06-25 fleet-control report) the Rust `fleet_terminal_previews` command + ring-cooking path were all left in place. This exact issue was flagged in docs/harness/combined-scan-2026-06-25/fleet-control.md:53-57 with a delete-or-wire decision request and is still unresolved three weeks later.
- **Impact**: ~180 lines of dead frontend code plus a dead Rust IPC command that reads as a live rendering tier — FleetTilePreview's own doc comment claims it is "the tier that lets the grid show 16 sessions", actively misleading anyone reasoning about grid performance. Every future fleet audit re-discovers and re-analyzes it.
- **Fix sketch**: Delete `FleetTilePreview.tsx`, `useFleetTilePreviews.ts`, and the `terminalPreviews` export in `src/api/fleet/fleet.ts`; then remove the Rust side (`fleet_terminal_previews` command and any preview/rev cooking used only by it — verify no other caller in src-tauri before deleting). Update context-map.json entries for the removed files. If the preview tier is instead wanted back someday, git history preserves it.

## 2. Attention-legend swatch colors hardcoded as rgba literals duplicating `.fleet-attn-*` in globals.css
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/fleet/FleetAttentionLegend.tsx:18-21
- **Scenario**: The legend's four swatch colors are inline rgba literals whose only link to the actual tile-border colors (`.fleet-attn-*` rules in globals.css) is a comment saying they "mirror" them. Anyone retuning an attention border color in CSS will not get a type error or grep hit on `fleet-attn` leading here — the legend silently drifts from the borders it decodes.
- **Root cause**: Two sources of truth for the same design tokens: CSS classes for the borders, JS literals for the legend, with a comment asserting (not enforcing) parity.
- **Impact**: Bounded — four colors, one component — but the comment's claim ("the legend can never drift") is the opposite of what hardcoding guarantees; a mismatched legend misleads the operator about which sessions need them.
- **Fix sketch**: Define the four attention colors once as CSS custom properties (e.g. `--fleet-attn-needs-you: rgba(167,139,250,.85)`) in globals.css, reference them from both the `.fleet-attn-*` border rules and the legend swatches (`style={{ backgroundColor: 'var(--fleet-attn-needs-you)' }}`). No visual change; single source of truth.

## 3. `useNowTick` gives every consumer its own interval — N desynced timers/re-renders instead of one shared tick
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/fleet/relativeAgo.ts:11
- **Scenario**: `useNowTick` is called per component instance — `FleetSessionCard`, `FleetTileStatusBlock` (one per non-live grid tile), `FleetMobilePreview`, `FleetNeedsYouBanner` — so a fleet with a dozen sessions runs a dozen independent 30s `setInterval`s, each firing at a different phase and each triggering its own isolated re-render, ~one every few seconds across the grid.
- **Root cause**: The hook's doc comment says it exists "so relative 'Xs ago' labels stay fresh without each row owning its own timer", but the implementation does exactly that: state + interval live inside each caller, nothing is shared.
- **Impact**: Modest — each render is cheap — but it is continuous background churn on the fleet grid (a screen that stays open for long stretches), and the desynced ticks make "ago" labels on adjacent tiles disagree by up to 30s.
- **Fix sketch**: Back the hook with one module-level ticker: a shared `useSyncExternalStore` store (single `setInterval` started on first subscriber, cleared on last) that all callers subscribe to. Same call signature, one timer, all labels update in the same frame. ~15 lines in relativeAgo.ts, no call-site changes.
