# UI Perfectionist — reviews-incidents-audit (2026-06-13)

> Total: 9 findings (1 critical, 4 high, 3 medium, 1 low)

The clearest signal in this surface is an internal split: the **incidents** module is a model
citizen — `IncidentDetailModal` uses `StatusBadge`, `StatusShape`, `RelativeTime`, and catalog
`Button`; `IncidentDetailBreakdown` uses `RelativeTime` + `CopyButton`. The **manual-review**
module, by contrast, hand-rolls almost every primitive (severity glyphs, status badges, relative
times, approve/reject buttons). Most findings below are the manual-review side failing to adopt
the same catalog the incidents side already uses one folder over.

---

## 1. Severity indicator is a hand-drawn inline SVG instead of StatusShape/statusTokens
- **Severity**: critical
- **Category**: reuse
- **File**: src/features/overview/sub_manual-review/components/ReviewListItem.tsx:8-38
- **Problem**: `SeverityIndicator` ships three bespoke 12×12 `<svg>` shapes with hard-coded
  `rgba(239,68,68,…)` / `rgba(245,158,11,…)` / `rgba(59,130,246,…)` fills baked straight into
  markup. This is the single source-of-truth violation: severity color is duplicated as raw rgba
  literals that bypass `statusTokens` entirely, won't theme, and won't track light/dark parity.
  The incidents module solves the identical problem correctly with `<StatusShape status={…} />`
  (see IncidentRow.tsx:70 and IncidentDetailModal.tsx:200). Two modules, same concept, two
  visually different severity glyphs — systemically wrong across the whole review surface.
- **Fix sketch**: Delete the inline SVGs; render `StatusShape` from
  `@/features/shared/components/display/StatusShape` with a severity→status map (critical→error,
  warning→warning, info→info) exactly as `severityShapeStatus` does for incidents. Color comes
  from `statusTokens`, not rgba literals.

## 2. Review status badge built from designTokens.STATUS_COLORS instead of StatusBadge
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_manual-review/components/ReviewListItem.tsx:108-133
- **Problem**: `InboxItem` reads `STATUS_COLORS` from `@/lib/utils/designTokens` and hand-assembles
  a badge `<span class={`… ${status.bg} ${status.text} ${status.border}`}>`. The catalog already
  has `StatusBadge` (used by the incidents side at IncidentDetailModal.tsx:198-204) which is the
  canonical status pill. Hand-rolling it means inconsistent padding/rounding/typography versus
  every other status pill in the app.
- **Fix sketch**: Replace with `<StatusBadge variant={…}>{statusLabel}</StatusBadge>` from
  `@/features/shared/components/display/StatusBadge`, mapping review status → badge variant.

## 3. Approve/Reject actions are raw buttons with literal emerald/red, not catalog Button
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:303-318 (also BulkActionBar.tsx:73-86, ActionZone.tsx:22-54, FocusedDecisionCard.tsx:94-121)
- **Problem**: The primary approve/reject affordances — the most important controls on this
  surface — are bespoke `<button>`s with hand-tuned `bg-emerald-500/10 text-emerald-400
  border-emerald-500/30` / `bg-red-500/…` classes and manual `disabled:opacity-50` handling. The
  incidents detail modal uses catalog `Button` with `variant`/`loading`/`disabled` props for the
  exact same approve/dismiss/resolve decision (IncidentDetailModal.tsx:130-185). Result:
  approve/reject look and behave differently depending on which review surface you're on, and the
  loading state is re-implemented four times with subtly different treatments.
- **Fix sketch**: Adopt catalog `Button` from `@/features/shared/components/buttons` (semantic
  variants for the destructive/confirm pair) with its built-in `loading` prop, replacing the
  four hand-rolled approve/reject button clusters. Consider `QuickAnswerReviewCard` for the
  decision-stepper pattern, which already exists in the catalog.

## 4. Timestamps use formatRelativeTime()/toLocaleString() instead of RelativeTime
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_manual-review/components/ReviewListItem.tsx:126; ReviewDetailPanel.tsx:113,137,249,263
- **Problem**: Manual-review renders timestamps via `formatRelativeTime(review.created_at)` (a
  static string) and, worse, ReviewDetailPanel.tsx:263 prints a raw
  `new Date(review.resolved_at).toLocaleString()` — locale-dependent, non-themed, and never
  auto-updating. The incidents module uses the catalog `<RelativeTime timestamp={…} />`
  consistently (IncidentDetailModal.tsx:231, IncidentDetailBreakdown.tsx:16), which gives a live
  relative string plus an absolute-time tooltip.
- **Fix sketch**: Replace every `formatRelativeTime(...)` call and the `toLocaleString()` with
  `<RelativeTime timestamp={...} />` from `@/features/shared/components/display/RelativeTime`.

## 5. IncidentRow severity accent + badge use raw red/amber instead of statusTokens
- **Severity**: medium
- **Category**: token
- **File**: src/features/overview/sub_incidents/components/IncidentRow.tsx:48-54,76-88
- **Problem**: Even the otherwise-exemplary IncidentRow hard-codes its gutter accent
  (`border-l-red-400/70`, `border-l-amber-400/70`) and the stale pill
  (`border-amber-400/40 text-amber-400`) as raw Tailwind color literals rather than deriving them
  from `statusTokens` (border/ring classes). It already routes the glyph through `StatusShape`, so
  the accent stripe being a separate raw literal is an inconsistency within the same row — the
  color of "critical" is defined in two places.
- **Fix sketch**: Derive the left-accent and stale-pill border/text from `statusTokens`
  (error/warning `border`+`text` entries) keyed off `severityRank`, so one token drives both the
  glyph and the stripe.

## 6. DesignReviewsPage error banner is a hand-rolled red strip, not ErrorBanner/InlineErrorBanner
- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/templates/components/DesignReviewsPage.tsx:55-60
- **Problem**: The page renders its fetch error as a bespoke
  `<div class="bg-red-500/10 border-b border-red-500/20 … text-red-400">{error}</div>` with no
  retry affordance. The incidents inbox handles the same async-error case with the catalog
  `InlineErrorBanner` including an `onRetry` (IncidentsInbox.tsx:432-439). The design-reviews page
  also exposes `refresh` from its hook but never wires a retry into the error state.
- **Fix sketch**: Replace the red `<div>` with `InlineErrorBanner` (or `ErrorBanner`) from
  `@/features/shared/components/feedback`, passing `message={error}` and `onRetry={refresh}`.

## 7. Multi-decision accept/reject controls use literal emerald/red text + ad-hoc divider
- **Severity**: medium
- **Category**: token
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:149-219
- **Problem**: The decisions sub-panel repeats raw `text-emerald-400` / `text-red-400` for its
  accept-all/reject-all links and per-row toggles, uses bare `|` glyph text nodes as separators
  (lines 160,167), and a `divide-primary/5` row divider that doesn't match `ROW_SEPARATOR`
  (`border-primary/[0.06]`). The summary footer counts (`acceptedCount`/`rejectedCount`) print
  through raw status colors instead of `Numeric` + status tokens.
- **Fix sketch**: Drive accept/reject colors from `statusTokens` (success/error `text`), use
  `Numeric` for the counts (already imported elsewhere in this module), and align the row divider
  to `ROW_SEPARATOR` from `listTokens`.

## 8. Cloud badge hard-codes indigo and is duplicated across two files
- **Severity**: low
- **Category**: token
- **File**: src/features/overview/sub_manual-review/components/ReviewListItem.tsx:134-138; ReviewDetailPanel.tsx:114
- **Problem**: The "Cloud" pill is hand-built twice with identical literal
  `bg-indigo-500/10 text-indigo-400 border-indigo-500/20` classes. A duplicated, non-tokenised
  badge that drifts the moment one copy is edited; indigo is not a theme token.
- **Fix sketch**: Extract a single `<StatusBadge variant="info">` (or a small shared `CloudBadge`)
  so both surfaces render one tokenised pill.

## 9. ConversationThread severity line restates "Info severity" as raw text beside the glyph
- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:110-114
- **Problem**: The thread header shows the hand-drawn `SeverityIndicator` glyph immediately
  followed by `{SEVERITY_LABELS[review.severity] ?? 'Info'} severity` as plain `typo-body` text,
  competing with the persona name above and the timestamp beside it — three same-weight tokens on
  one low-hierarchy line. The incidents detail header solves this cleanly with a single
  `StatusBadge` carrying glyph + label together (IncidentDetailModal.tsx:197-205).
- **Fix sketch**: Collapse glyph + label into one `StatusBadge` (per finding 1/2) so severity
  reads as a single chip rather than a glyph plus a competing text run.
</content>
</invoke>
