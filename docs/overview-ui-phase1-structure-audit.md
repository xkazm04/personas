# Overview UI Phase 1 — Structure Audit (Current State)

Date: 2026-02-19
Scope: `src/features/overview` (9 submodules)
Goal: Capture current layout anatomy before defining design passes.

## 1) Module Surface Map

Overview container:
- `src/features/overview/components/OverviewPage.tsx`
- Uses `overviewTab` switch and renders one submodule at a time in a shared animated shell.

Submodules:
1. Executions → `sub_executions/GlobalExecutionList.tsx`
2. Manual review → `sub_manual-review/ManualReviewList.tsx`
3. Messages → `sub_messages/MessageList.tsx`
4. Events → `sub_events/EventLogList.tsx`
5. Usage → `sub_usage/UsageDashboard.tsx`
6. Observability → `sub_observability/ObservabilityDashboard.tsx`
7. Realtime → `sub_realtime/RealtimeVisualizerPage.tsx`
8. Memories → `sub_memories/MemoriesPage.tsx`
9. Budget → `sub_budget/BudgetSettingsPage.tsx`

## 2) Structural Snapshots by Submodule

### Executions (`GlobalExecutionList`)
- Top filter pill row + refresh action.
- Scrollable list of expandable rows.
- Row anatomy: chevron, persona chip, status badge, duration, relative time, optional inline error.
- Expanded body: output block, error block, metadata strip.
- Bottom pagination: “Load More”.

### Manual Review (`ManualReviewList`)
- Filter pills only (all/pending/approved/rejected).
- Scrollable expandable rows.
- Row anatomy: severity dot, persona mini chip, truncated content, status badge, relative time.
- Expanded body: full content, reviewer notes input (pending only), approve/reject actions, metadata.

### Messages (`MessageList`)
- Filter pill row + refresh + mark-all-read.
- Scrollable expandable rows with responsive dual row mode (desktop vs mobile).
- Row anatomy: unread dot, persona mini chip, title/content preview, optional priority badge, time.
- Expanded body: full content, delivery status list, delete confirmation flow, metadata and execution jump action.
- Bottom pagination: “Load More”.

### Events (`EventLogList`)
- Filter pills + refresh icon.
- Scrollable expandable cards.
- Row anatomy: status icon, event type, source→target text, status badge, relative time, chevron.
- Expanded body: key-value metadata grid, payload JSON block, optional error block.

### Usage (`UsageDashboard`)
- Compact filter row (persona + day range).
- Empty state branch.
- Multi-section chart layout:
  - Top row: horizontal bar chart + donut/pie chart.
  - Middle: stacked area usage over time.
  - Bottom: by-persona horizontal bar chart.
- Heavy chart-card structure with repeated card shells.

### Observability (`ObservabilityDashboard`)
- Header with controls (persona/day range/auto-refresh).
- Summary KPI card grid.
- Chart row 1: cost area + execution distribution pie.
- Chart row 2: execution health bar chart.
- Health issue panel:
  - custom header with issue count + run analysis action
  - issue rows with severity/category/age + resolve action
  - modal drilldown (`HealingIssueModal`).

### Realtime (`RealtimeVisualizerPage`)
- Top stats/action bar (`RealtimeStatsBar`).
- Main visualization canvas (`EventBusVisualization`) with lane, nodes, particles.
- Conditional bottom event drawer (`EventDetailDrawer`).
- Interaction model is visualization-first rather than list-first.

### Memories (`MemoriesPage`)
- Rich header with icon, summary count, and filter/search controls.
- Mixed responsive patterns:
  - desktop table header + row columns
  - mobile stacked card rows.
- Expandable row content with tags and source metadata.
- Client-side sort controls in table header.

### Budget (`BudgetSettingsPage`)
- Header + monthly spend summary card.
- Persona budget list of cards.
- Card anatomy: persona identity, status badge, optional progress bar, inline numeric budget editor with save.
- Empty state when no personas.

## 3) Shared Structural Patterns (Observed)

Strongly repeated:
- Filter pill strips (executions/manual-review/events/messages).
- Expandable row/card interaction with chevrons.
- Empty state with icon + short helper text.
- Soft bordered cards with secondary translucent backgrounds.
- Relative timestamps and monospace micro-meta.

Divergent patterns:
- Header strategy is inconsistent (some modules have full title/subtitle, some none).
- Filter/control placement differs significantly between list modules.
- Density varies (memories and messages are compact; observability and usage are roomy chart-first).
- Expanded-detail spacing and metadata formatting vary by module.
- Action language and button hierarchy differ per module.

## 4) Structural Risk Flags (for next phases)

- Inconsistent shell paddings (`p-6`, `pt-4`, `px-6 py-5`, etc.) may create visual jump between tabs.
- Similar list modules implement near-duplicate row architectures with slightly different micro-layout rules.
- Chart modules use separate card/header spacing patterns that may diverge from list modules.
- Realtime has a unique canvas-first interaction model and will likely need a dedicated pass profile.
- `sub_manual-review/ReviewExpandedDetail.tsx` appears to be template-design specific and not currently referenced by `ManualReviewList`; verify active usage before styling passes.

## 5) Phase 1 Completion Criteria Check

- [x] Mapped all 9 overview submodules.
- [x] Captured top-level structure and major interaction regions.
- [x] Captured nested support surfaces (filters, modal, drawer, realtime widgets).
- [x] Logged shared patterns and structural divergence.

Next: Phase 2 (visual token audit: typography/spacing/density/state affordances).
