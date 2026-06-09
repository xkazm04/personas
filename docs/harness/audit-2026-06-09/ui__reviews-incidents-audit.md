# UI Perfectionist — reviews-incidents-audit
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. Destructive "reject / dismiss" carries the same visual weight as the safe action
- **Severity**: high
- **Category**: visual-hierarchy
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:299-314
- **Scenario**: In the conversation-thread action bar the user sees an Approve button and a Reject button rendered as identical-weight tinted pills (`bg-emerald-500/10 … border-emerald-500/30` vs `bg-red-500/10 … border-red-500/30`) — same size, same border opacity, same fill. The same equal-weight pairing repeats in the bulk bar (BulkActionBar.tsx:73-86), the focus-flow ActionZones (ReviewFocusFlow.tsx:535-583, where Reject is even the left/first column and Approve last), the FocusedDecisionCard verdict buttons (FocusedDecisionCard.tsx:94-117), and the incident row buttons where Resolve / Dismiss / Reopen are all the same neutral `border-primary/15` pill (IncidentRow.tsx:135-151).
- **Root cause**: Approve and reject are differentiated by hue alone. Color is the only signal separating a reversible "approve" from a destructive "reject/dismiss"; for a red-green colorblind user the two read as visually equal, and even for sighted users nothing draws the eye to "this is the irreversible one." The codebase already owns a `Button` with a `danger`/destructive idiom (used in IncidentDetailModal) but the inline review/incident buttons hand-roll their own equal-weight pills.
- **Impact**: error-blind — easy to fat-finger reject; destructive action has no extra friction or weight.
- **Fix sketch**: Give the destructive action a distinct treatment, not just a different hue: e.g. reject/dismiss as an outline/ghost pill while approve is the solid filled primary (or vice-versa), plus add the existing `XCircle`/`Trash2` icon consistently. Reuse the shared `Button` `variant` system (the `danger` styling already in ConfirmDialog.tsx:56-60) instead of bespoke `bg-red-500/10` strings so the destructive language is defined once.

## 2. Inconsistent confirm-on-destructive: delete-all is gated, but bulk-reject and incident-dismiss fire instantly
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/overview/sub_manual-review/components/BulkActionBar.tsx:80-86
- **Scenario**: "Delete all" reviews opens a proper `ConfirmDialog` (ManualReviewList.tsx:436-445). But "Reject all" in the bulk bar fires on a single click into an inline confirm row that re-uses the bulk bar itself (BulkActionBar.tsx:29-59) — a lighter, easy-to-miss gate — while in the incidents inbox the bulk "Resolve N / Dismiss" buttons (IncidentsInbox.tsx:334-339) and the per-agent "Resolve all" (IncidentAgentGroup.tsx:78-86) and the per-row "Dismiss" (IncidentRow.tsx:140) all execute immediately with no confirmation at all. Three surfaces that do the same class of destructive bulk operation each guard it differently (modal / inline / none).
- **Root cause**: No shared "destructive action needs confirmation" contract. Each surface decided independently whether/how to confirm, so the safety affordance is unpredictable.
- **Impact**: inconsistency + error-blind — a user who learns "delete asks first" is surprised when "dismiss 12 incidents" does not.
- **Fix sketch**: Route all bulk/destructive closes (bulk reject, bulk resolve, bulk dismiss, per-row dismiss) through the same `ConfirmDialog` with `danger` already used for delete-all, showing the count. At minimum make the inline reject-confirm and the incident bulk path use one shared confirm component so the gate is identical everywhere.

## 3. DesignReviewsPage renders no loading state — the hook exposes `isLoading` but the page drops it
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/templates/components/DesignReviewsPage.tsx:24-28
- **Scenario**: On open, the design-reviews page shows the header with a count of `reviews.length` (which is `0` during the async fetch) and an empty body — there is no skeleton or spinner — until data lands and the list/count snaps in. The subtitle briefly reads "0 templates" then jumps.
- **Root cause**: `useDesignReviews()` returns an `isLoading` flag (useDesignReviews.ts:44, 294-309) that is wired through `refresh` and initial fetch, but `DesignReviewsPage` destructures only `{ reviews, error, refresh }` and never reads it. The page has an error branch (lines 50-54) but no loading branch, so the in-between state is invisible — unlike the sibling surfaces (IncidentsInbox.tsx:358-361 shows `LoadingSpinner`, ManualReviewList.tsx:358-360 shows `ListSkeleton`).
- **Impact**: error-blind / unpolished — momentary blank + misleading "0" count; inconsistent with the loading treatment every other review surface already ships.
- **Fix sketch**: Destructure `isLoading` and render a skeleton/spinner before the tab content when `isLoading && reviews.length === 0`, mirroring IncidentsInbox's `LoadingSpinner` pattern. Also guard the subtitle count so it doesn't flash "0" while loading.

## 4. Three divergent severity visual languages across the three surfaces
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/overview/sub_manual-review/components/ReviewListItem.tsx:8-38
- **Scenario**: The same severity concept is drawn three different ways: the review inbox uses hand-rolled inline `<svg>` polygons (triangle/diamond/circle) for critical/warning/info (ReviewListItem.tsx:10-37); the review focus flow uses plain colored `rounded-full` dots (ReviewFocusFlow.tsx:290-307, 321) plus a separate `SeverityBadge` pill (ReviewFocusFlow.tsx:42-50); and the incidents inbox uses the shared `StatusShape` component plus an `IncidentSeverityLegend` (IncidentRow.tsx:86-94, IncidentSeverityLegend.tsx). A user moving between "reviews" and "incidents" must relearn the severity vocabulary, and the review side has no legend at all.
- **Root cause**: The incidents module adopted the shared `StatusShape` + legend pattern; the manual-review module predates/ignored it and rolls its own SVG and dot encodings. No single severity-indicator component is shared.
- **Impact**: inconsistency — colorblind-safe shapes exist in one surface but not the others; severity reads as a different thing per screen.
- **Fix sketch**: Standardise on the shared `StatusShape` (already colorblind-safe via shape) for severity across review inbox rows, the focus-flow queue dots, and badges. Promote `IncidentSeverityLegend` into a shared legend and surface it on the review queue too so the shape vocabulary is taught consistently.

## 5. Queue-row / verdict-button markup is duplicated rather than extracted
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:148-216
- **Scenario**: The "multi-decision" accept/reject list is implemented twice with near-identical markup and logic: once in ReviewDetailPanel.tsx (decisions list, accept-all/reject-all/clear header, per-item `CheckCircle2`/`XCircle` toggles, accepted/rejected/undecided summary strip, lines 148-216) and again in ReviewFocusFlow.tsx via FocusedDecisionCard + the summary strip (ReviewFocusFlow.tsx:459-493, FocusedDecisionCard.tsx:89-119). Both maintain their own `decisionStates`/`decisionVerdicts` map, both re-derive accepted/rejected/undecided counts, both hand-roll the same emerald/red toggle classes. The verdict-button pair pattern also appears a third time inline in BulkActionBar.
- **Root cause**: No shared `DecisionItem` row / verdict-toggle / decision-summary component; the two review entry points (split-inbox detail vs focus flow) each re-implemented the decision UI.
- **Impact**: inconsistency + unpolished — the two decision UIs already differ subtly (icon-only toggles vs labelled buttons, different summary wording) and will drift further; double the surface area for any a11y or styling fix.
- **Fix sketch**: Extract a `DecisionRow` (label + category + accept/reject toggle), a `DecisionToolbar` (accept-all/reject-all/clear), and a `DecisionSummary` (counts) used by both ReviewDetailPanel and ReviewFocusFlow. Centralises the verdict color/weight decision from finding #1 too.

## 6. Verdict toggles and selection controls miss keyboard/ARIA state
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:189-202
- **Scenario**: The per-decision Accept/Reject toggles are icon-only `<button>`s whose only state cue is a background tint and whose only label is a `title` attribute (ReviewDetailPanel.tsx:189-202); a screen-reader user hears "Accept"/"Reject" but never which one is currently selected. The same is true of the FocusedDecisionCard verdict buttons (FocusedDecisionCard.tsx:94-117) — selected state is conveyed by `ring`/bg only, no `aria-pressed`. The review-inbox selection checkboxes are custom `CheckSquare`/`Square` icon buttons with no `aria-label`/`aria-checked` and no `role` (ReviewInboxPanel.tsx:118-130), and the header "Delete all" is an icon-only `Trash2` button with only a `title` (ManualReviewList.tsx:315-323) — no visible or accessible text label for a destructive control. By contrast the incidents surface does this well (real `<input type=checkbox>` with `aria-label`, `aria-live` announcements, j/k keyboard triage — IncidentsInbox.tsx:71-77, 176-242, 311-313), highlighting the gap on the review side.
- **Root cause**: Review-side toggles/selection were built as styled `<button>`/`<div>` with visual-only state, skipping `aria-pressed`/`aria-checked` and accessible names, whereas the incidents module adopted semantic inputs + live regions.
- **Impact**: inaccessible — toggle and selection state is invisible to assistive tech; an icon-only destructive "delete all" is unlabelled.
- **Fix sketch**: Add `aria-pressed` to the accept/reject verdict buttons and `aria-checked`/`role="checkbox"` (or a real `<input type=checkbox>`) to the inbox selection control with an `aria-label`. Give the "Delete all" button an `aria-label` (and ideally a visible label, matching "Clear stale" beside it). Adopt the incidents inbox's `aria-live` row-action announcement pattern for review approve/reject so the result is announced.
