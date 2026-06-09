# UI Perfectionist — dev-ideas-scanner-context-map
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. Scanner is error-blind: failed scans set `scanPhase: 'error'` but render nothing inline
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/plugins/dev-tools/sub_scanner/IdeaScannerPage.tsx:593
- **Scenario**: A user runs a scan, it fails (CLI error, timeout, cancelled). The progress bar disappears, a transient notification-center toast fires (line 144-152), then the results region falls back to the generic empty placeholder reading `no_results_yet` — the exact same text shown before any scan has ever run. The user has no idea the scan failed; it looks like the scan simply found nothing.
- **Root cause**: `finalizeScan` sets `useSystemStore.setState({ scanPhase: 'error' })` (line 158) but the JSX only branches on `isRunning` (`scanPhase === 'running'`, line 48) and `ideas.length`. There is no render branch for the `error` phase, so the failure state is invisible on the page itself. The empty block (line 593-601) only distinguishes "no ideas at all" vs "no ideas match filter" — never "last scan errored".
- **Impact**: error-blind
- **Fix sketch**: Add an inline error panel that renders when `scanPhase === 'error'` — a bordered `border-red-500/20 bg-red-500/5 rounded-modal p-4` box with an `AlertCircle` icon, the failure summary, and a "Retry scan" `Button` wired to `handleRunScan`. Mirror the existing `ScanProgress`/auto-scan progress panels (line 495-526) so the success, running, and error phases share one visual family. Pair the colour with the icon + text so it isn't colour-only.

## 2. Effort/Impact/Risk badge markup is reimplemented per surface and drifts visually
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/plugins/dev-tools/sub_scanner/IdeaScannerCards.tsx:53
- **Scenario**: The same effort/impact/risk pill appears on scanner result cards, triage swipe cards, and (conceptually) the scoreboard, but each is built from different markup. On the scanner card it reads `Effort: 7`; on the triage card the identical concept reads `effort: 7` (lowercase, no i18n label). Two screens, same data, different casing and structure — they don't look like the same component.
- **Root cause**: `LevelBadge` (IdeaScannerCards.tsx:53-59) is the canonical pill, but `SwipeCard` re-inlines an equivalent `<span>` loop (IdeaTriagePage.tsx:139-146) instead of importing it, hardcoding the raw key (`{key}: {idea[key]}`) rather than the translated `ds.level_effort` labels the scanner uses. The shared `levelColor()` helper is reused, but the wrapper markup, casing, and label source are forked.
- **Impact**: inconsistency
- **Fix sketch**: Export `LevelBadge` (already exported) and use it in `SwipeCard` in place of the inline span loop, passing the i18n `level_effort/impact/risk` labels. This makes the casing, padding, font, and border identical across scanner and triage and turns a future style tweak into a one-file edit.

## 3. Numeric level badges use `text-md` and convey severity by colour alone
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/plugins/dev-tools/constants/ideaColors.ts:48
- **Scenario**: Effort/Impact/Risk pills are green (≤3), amber (≤6), or red (>6). A user with red-green colour-vision deficiency cannot distinguish a low-risk (green) idea from a high-risk (red) one at a glance — both pills are the same shape, size, and weight; only the hue differs. The number is present but the at-a-glance severity signal is purely chromatic. The pills are also rendered at `text-md` (LevelBadge, IdeaScannerCards.tsx:55), the body font size, so they read as inline text rather than compact metadata badges.
- **Root cause**: `levelColor()` returns only background/text/border colour classes keyed to thresholds — no icon, shape, or text differentiator accompanies the hue. The badge label is the metric name (`Effort`), not a severity word, so colour is the only encoding of low/med/high.
- **Impact**: inaccessible
- **Fix sketch**: Add a non-colour severity cue inside `LevelBadge` — e.g. a tiny up/down arrow or a `low/med/high` suffix derived from the same thresholds, or vary the dot/icon. Drop the badge type ramp to `text-[10px]`/`typo-caption` to match the category pill family and read as metadata, not prose.

## 4. Triage effort/risk filter buttons are icon-only with no accessible name and colour-only active state
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/plugins/dev-tools/sub_triage/EffortRiskFilter.tsx:52
- **Scenario**: The Effort and Risk filters in the triage sidebar are three square icon-only buttons each (Quick Wins / Moderate / Heavy). A screen-reader user lands on a button announced only as "button" with no name — the label exists solely in a `title` attribute (not reliably exposed) and is never rendered as text. The selected preset is indicated only by a colour swap (`colors.active` vs `colors.inactive`); there is no `aria-pressed`, checkmark, or border-weight change, so the active filter is invisible to assistive tech and hard to spot for low-vision users.
- **Root cause**: Each `<button>` (lines 52-60, 79-87) contains only an `<Icon>` and a `title`; no `aria-label`, no `aria-pressed={isActive}`, and the active/inactive distinction is implemented purely with colour classes (`PRESET_COLORS`, lines 23-27).
- **Impact**: inaccessible
- **Fix sketch**: Add `aria-label={p.label}` and `aria-pressed={isActive}` to each button. Reinforce the active state with a non-colour cue (ring or border-weight bump, e.g. `ring-2 ring-current`) so the selected preset is perceivable without colour. Consider showing the label text on hover/focus or below the icon row.

## 5. Status visual language diverges between Task Runner and Scanner history for the same states
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/plugins/dev-tools/sub_runner/TaskRunnerPage.tsx:96
- **Scenario**: Task Runner renders status as an icon+label pill (`StatusBadge`: spinning `Loader2` for running, `CheckCircle2` for completed, etc., line 96-106). The Scanner history table renders the conceptually-identical scan status as a bare text pill with no icon (`SCAN_STATUS_STYLES`, IdeaScannerCards.tsx:264-266) showing the raw lowercase status string (`complete`, `running`, `error`). A user moving between the two dev-tools tabs sees "running" represented two different ways, and the scanner version is colour-only with no icon and an untranslated raw token.
- **Root cause**: There is no shared status-badge primitive. `StatusBadge` lives privately in TaskRunnerPage; the scanner history reimplements status as colour classes only, and the scan status set (`complete`/`running`/`error`) doesn't align with the runner's token-mapped labels.
- **Impact**: inconsistency
- **Fix sketch**: Extract `StatusBadge` (icon + label + pill) into a shared dev-tools component and reuse it in `ScanHistoryTable`, mapping scan statuses to the same icon vocabulary (spinner/check/alert). This unifies the status language across runner, scanner history, and auto-run, and removes the colour-only + raw-token rendering.

## 6. AgentCard unselected checkbox is rendered in the same neutral colour as selected affordances, weakening the selection signal
- **Severity**: medium
- **Category**: visual-hierarchy
- **File**: src/features/plugins/dev-tools/sub_scanner/IdeaScannerCards.tsx:101
- **Scenario**: In the agent picker grid, a selected agent shows an amber `CheckSquare`; an unselected one shows a `Square` in `text-foreground` — the same neutral colour used for the help `Info` icon beside it. When the user wants to confirm which agents are armed before hitting the primary "Run Scan" action, the selection state is subtle: the tile also gets an amber ring (line 84), but the corner indicator's selected/unselected difference is low-contrast and the unselected `Square` competes visually with the adjacent info icon. There is no `role`/`aria-pressed` on the toggle button either, so selection isn't announced.
- **Root cause**: The selection indicator relies on a small icon swap (`CheckSquare` amber vs `Square` foreground, line 102-107) plus a ring; the unselected icon shares the neutral foreground colour of the unrelated info affordance, and the `<motion.button>` (line 77) carries no `aria-pressed={selected}` to expose state.
- **Impact**: unpolished
- **Fix sketch**: Dim the unselected `Square` (`text-foreground/30`) so the amber `CheckSquare` clearly wins the eye, and add `aria-pressed={selected}` + `aria-label={agent.label}` to the toggle button so the armed/disarmed state is both visible and announced before the user commits to the primary Run Scan action.
