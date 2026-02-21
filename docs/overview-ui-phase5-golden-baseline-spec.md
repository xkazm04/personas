# Overview UI Phase 5 — Golden Baseline Spec

Date: 2026-02-19
Scope: all overview submodules
Intent: define a single styling/interaction baseline to guide all UI upgrade rounds.

## 1) Baseline System Principles

1. **One shell rhythm** across overview tabs.
2. **Two density modes only**:
   - `compact-list` for row-heavy tabs,
   - `dashboard` for chart/summary tabs.
3. **State-first UX contract**: loading, empty, error, ready always explicitly addressed.
4. **Micro-typography restraint**: reserve ultra-small text for metadata only.
5. **Accessibility parity**: all clickable rows keyboard-operable.

## 2) Global Token Baseline

### Typography
- Page title: `text-xl font-semibold`
- Section/card title: `text-sm font-semibold text-foreground/80`
- Body: `text-sm text-foreground/70`
- Control label/meta: `text-xs`
- Micro labels/badges: `text-[11px]`
- Ultra micro (`text-[10px]` / `text-[9px]`) only for constrained telemetry metadata.
- Metadata strip style: `text-[11px] font-mono text-muted-foreground/40`

### Spacing
- Shell:
  - list modules: `p-6 pt-4`
  - dashboard modules: `p-6 space-y-6`
- Card padding: `p-4` default; `p-5` reserved for hero/summary cards only.
- Row height target: `py-2.5` to `py-3`.
- Standard gaps: `gap-2`, `gap-3`, `gap-4`; avoid ad hoc values unless required by chart/render constraints.

### Surface & Borders
- Primary container card: `rounded-xl border border-primary/15 bg-secondary/30`
- Interactive row card: `rounded-xl border border-primary/15 bg-secondary/20 hover:bg-secondary/30`
- Overlays (modal/drawer): `rounded-2xl border border-primary/20 bg-background/95 backdrop-blur-*`
- Border token normalization: prefer `border-primary/*` in overview unless semantically necessary.

### Badges & Chips
- Badge shape: `px-2 py-0.5 rounded-md text-[11px] font-medium border`
- Counter pill: `text-[10px] rounded-full min-w-[18px]`
- Semantic color palette: success/amber/red/blue tokenized consistently across modules.

## 3) Interaction Contracts

### List Module Contract (`executions`, `manual-review`, `messages`, `events`, `memories`)
- Top bar must include:
  - filter controls (if applicable),
  - refresh action (if data can stale).
- Every row must support:
  - pointer expand/collapse,
  - keyboard activation (Enter/Space) and visible focus.
- Expanded section must preserve:
  - title/meta strip,
  - content block,
  - action block (if present),
  - metadata footer.

### Dashboard Module Contract (`usage`, `observability`, `budget`)
- Header + controls stay visually stable.
- Cards/charts follow shared card shell and title style.
- Empty/no-data states use one standardized pattern.

### Visualization Contract (`realtime`)
- Realtime remains distinct (canvas-first), but:
  - stats bar control styling follows shared button token rules,
  - drawer metadata typography follows global micro rules,
  - empty/fallback messaging follows shared voice/style.

## 4) State UX Contract

Each submodule should implement all relevant states:
1. **Loading** (skeleton/spinner/placeholder text)
2. **Empty** (icon + title + actionable hint)
3. **Error** (inline non-blocking feedback where operation failed)
4. **Success feedback** (where user action completes)

Minimum requirement:
- no console-only user-impacting failures for visible actions.

## 5) Accessibility Contract

- Clickable non-button containers must become semantic buttons or include:
  - `role="button"`, `tabIndex={0}`, Enter/Space handlers.
- Modal/dialog surfaces require:
  - close affordance, Escape support, focus control.
- Icon-only controls require `title` or `aria-label`.

## 6) Motion Contract

- Standard list motion:
  - enter/exit subtle vertical offsets (4–8px) with short durations.
- Expand/collapse:
  - `height + opacity` transitions; no aggressive easing.
- Dashboard motion:
  - minimal, non-distracting.
- Realtime remains expressive, but avoids introducing unrelated motion idioms into other modules.

## 7) Baseline Acceptance Criteria (for pass completion)

A module is considered baseline-compliant when:
- Shell spacing and card/border tokens match baseline profile.
- Typography ladder uses approved scales for at least 95% of text surfaces.
- Required states (loading/empty/error) are implemented and visible.
- Row interactions are keyboard-accessible where expandable/clickable.
- Filter controls and badge semantics visually align with shared patterns.
