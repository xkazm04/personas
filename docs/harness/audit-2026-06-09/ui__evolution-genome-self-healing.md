# UI Perfectionist — evolution-genome-self-healing
> Total: 5
> Severity: 0 critical, 2 high, 2 medium, 1 low

> Scope note: the "genome / breeding / evolution-cycle" half of this context has NO frontend surface. `src/features/agents/sub_lab/index.ts:2-6` documents that the Breed / Evolve / A-B / Improve / Regression panels were removed in the "consolidation redesign" and moved to a headless Athena companion; the Lab now renders only the `LabVersionsTable`. There is no genome/variant-comparison view, no fitness chart, and no evolution-cycle UI to audit. All findings below therefore concern the **self-healing** surface (`sub_observability`), which is mature and high quality — the issues are refinements, not gaps.

## 1. AI-healing failure produces no diagnostic detail — only a red stepper
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/overview/sub_observability/components/AiHealingStreamOverlay.tsx:106-235
- **Scenario**: A user triggers AI healing; it fails. The header flips to "AI Healing Failed" and the active stepper dot turns red (lines 162-164), but the body renders nothing failure-specific: `diagnosis`, `fixesApplied`, and `lines` are all gated on truthy/non-empty content, and there is no dedicated failure block explaining *why* it failed or what to do next. On a clean failure (no streamed lines) the user sees a red title and an empty card.
- **Root cause**: The component models success richly (diagnosis box, fixes-applied list, log) but has no symmetric error state. `isFailed` only drives icon/color, never a message surface.
- **Impact**: error-blind — the user cannot tell what went wrong or whether to retry/escalate.
- **Fix sketch**: When `healing.phase === 'failed'`, render a red `bg-red-500/5 border-red-500/15` block mirroring the diagnosis box, showing a failure reason (reuse `healing.diagnosis` if present, else a generic "Healing could not complete" string) and a Retry affordance. Keep the log visible so the last streamed lines remain inspectable.

## 2. Nested interactive controls inside a listbox option row
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/overview/sub_observability/components/IssuesList.tsx:54-106
- **Scenario**: Each issue row is `role="option"` with its own `onClick` (lines 55-64), yet it *contains* a `<button>` for the title (lines 89-94) and a "Resolve" `<button>` (lines 100-105). Screen readers announce an option that nests two buttons; keyboard users tabbing land on buttons that are inside a row whose own activation is `Enter`-on-the-row. Clicking the title button and clicking the row do the same thing (both `onSelectIssue`), so the inner title button is redundant interactive surface.
- **Root cause**: Interactive children placed inside an already-interactive `role="option"` container — an ARIA listbox option must not contain focusable descendants.
- **Impact**: inaccessible — broken listbox semantics, duplicate/competing click targets, confusing focus order.
- **Fix sketch**: Make the title a non-interactive `<span>` (the row already handles selection). Keep "Resolve" as the only inner control but move it out of the option's accessible name — e.g. give the row a real `aria-label` and stop the Resolve `onClick` from bubbling (`e.stopPropagation()`), or render the row as a `<div role="option">` whose only action is select and surface Resolve on hover/focus via a visually-grouped secondary action.

## 3. View-mode toggle buttons use raw snake_case tooltips and lack pressed state
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/overview/sub_observability/components/HealingIssuesPanel.tsx:108-122
- **Scenario**: The list/timeline toggle buttons set `title={"list_view"}` and `title={"timeline_view"}` (lines 111, 120) — raw i18n keys, not translated strings — so a hovering user sees the literal text `list_view`. The buttons also carry no `aria-label` and no `aria-pressed`, so a screen-reader user hears only "button" with no name and no on/off state, even though they form a toggle group.
- **Root cause**: Placeholder string literals left in place of `t.*` lookups, and missing toggle ARIA. Contrast with the well-formed `aria-label` on the Run-analysis button just below (line 126).
- **Impact**: inaccessible + inconsistency — untranslated tooltip leaks an internal key; toggle state is invisible to assistive tech.
- **Fix sketch**: Replace literals with translated labels (`t.overview.healing_issues_panel.list_view` / `.timeline_view`), add matching `aria-label`, and add `aria-pressed={viewMode === 'list'}` / `aria-pressed={viewMode === 'timeline'}`.

## 4. Timeline badge cluster bypasses typography tokens with raw `text-[10px]`
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/overview/sub_observability/components/HealingTimeline.tsx:74-94, 116-152
- **Scenario**: The chain-card badges (breaker, retry count, severity, category, timestamp) and the inner event labels use hard-coded `text-[10px]` and ad-hoc `font-mono` (lines 75, 80, 84, 88, 92, 132, 135, 149) instead of the project's `typo-code` / `typo-caption` tokens used everywhere else (e.g. the sibling `IssuesList` and `HealingStatusBadge` use `typo-code`). The result is a slightly different font-size/leading for the same conceptual badges across the two views (list vs timeline), visible when toggling.
- **Root cause**: Inline arbitrary font sizing instead of the design-system typography utilities, drifting from the established badge convention.
- **Impact**: inconsistency — same badges render at different scales depending on view; undermines the typography system.
- **Fix sketch**: Swap `text-[10px]` for `typo-code`/`typo-caption` and reuse the shared `HealingStatusBadge` (already exists, supports `compact`) for the severity/breaker/retry badges so list and timeline stay pixel-identical.

## 5. Resolved-animation duplicate rings are static, not animated as intended
- **Severity**: low
- **Category**: polish
- **File**: src/features/overview/sub_observability/components/HealingIssueModal.tsx:93-106
- **Scenario**: On resolve, two stacked `rounded-full` rings render behind the checkmark (lines 94-101), clearly intended as a success "pulse/ripple" effect, but both use the same one-shot `animate-fade-slide-in` as everything else — so they fade/slide in once and sit static instead of rippling outward. The two identical overlapping rings then read as a faint double border rather than an intentional flourish.
- **Root cause**: Reuse of the generic entrance animation for an element that wants a radiating/ping effect; no distinct ripple keyframe.
- **Impact**: unpolished — the celebratory moment looks like a rendering artifact (doubled ring).
- **Fix sketch**: Give the outer ring a `motion-safe:animate-ping` (or a scoped ripple keyframe with stagger between the two rings) and drop one ring if a single ripple reads cleaner; keep `motion-reduce` opt-out for the existing reduced-motion convention seen elsewhere in this folder.
