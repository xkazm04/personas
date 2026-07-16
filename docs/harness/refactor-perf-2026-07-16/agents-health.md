# agents/health — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 1 medium / 3 low)
> Context group: Observability & Monitoring | Files read: 12 | Missing: 0

## 1. HealthWatchToggle refetches its setting on every persona object replacement, not just persona switches
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_health/HealthWatchToggle.tsx:29
- **Scenario**: The load effect depends on the `persona` object reference (`[persona]`). Any store mutation that replaces the selected persona object — e.g. `applyPersonaOp` from the adjacent "Apply Fix" flow (useApplyHealthFix.ts), a rename, or a design-context save — refires the effect and issues a fresh `GET /api/settings/health-watch/{id}` even though the persona id is unchanged.
- **Root cause**: Effect keyed on object identity when the fetch only depends on `persona.id`.
- **Impact**: Redundant management-API round-trips on a panel that co-exists with mutation actions; a late-resolving stale GET can also momentarily flip the toggle back to the server value the user just changed elsewhere.
- **Fix sketch**: Key the effect on `persona?.id` (capture the id in a local const to satisfy exhaustive-deps) and keep the existing `cancelled` guard. The toggle's POST path already uses `persona.id` only, so nothing else changes.

## 2. Severity-to-icon mapping duplicated between HealthIssueCard and HealthIssueModal
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_health/HealthDigestPanel.tsx:159
- **Scenario**: `HealthIssueModal` picks the severity icon with an inline ternary (`error ? XCircle : warning ? AlertTriangle : Info`), while `HealthIssueCard.tsx:14` defines the identical mapping as `SEVERITY_ICONS`. Both pair with the shared `SEVERITY_STYLES` token — the icon half of the pairing has drifted into two copies.
- **Root cause**: The map lives privately inside HealthIssueCard, so the digest modal re-derived it inline.
- **Impact**: A future severity (or icon swap) must be updated in two places; one will inevitably be missed and the digest modal and per-persona panel will disagree visually.
- **Fix sketch**: Move `SEVERITY_ICONS` into `statusConfig.ts` (which already centralizes status icon/label/dot config) or export it from HealthIssueCard, and consume it in HealthIssueModal. Two-line change per call site.

## 3. HealthIssueModal threads `t`/`tx` through props while sibling components call useTranslation directly
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/agents/sub_health/HealthDigestPanel.tsx:107
- **Scenario**: `HealthIssueModal` takes `t: Translations` and `tx` as props (forcing an import of the `Translations` type from `@/i18n/en`), while `PersonaDigestRow` in the same file simply calls `useTranslation()` itself.
- **Root cause**: Leftover from an earlier extraction; there is no render-cycle constraint here (the modal is a normal React component), so prop-threading buys nothing.
- **Impact**: Inconsistent i18n access pattern within one file, an extra type import, and a wider prop surface to maintain.
- **Fix sketch**: Call `const { t, tx } = useTranslation()` inside `HealthIssueModal`, drop the two props and the `Translations` import, and remove `t={t} tx={tx}` at the call site.

## 4. Stale doc-comment path references retired `agents/health/` location
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/agents/sub_health/types.ts:15
- **Scenario**: The `HealthFixProposalAction` doc comment points readers to `src/features/agents/health/useApplyHealthFix.ts`, but the file lives at `src/features/agents/sub_health/useApplyHealthFix.ts`.
- **Root cause**: The subtree was renamed/moved (health → sub_health) and the comment was not updated.
- **Impact**: Misleads anyone tracing the "only runtime consumer" claim; a grep for the documented path finds nothing.
- **Fix sketch**: Update the path in the comment to `./useApplyHealthFix.ts` (relative, so it survives future moves).
