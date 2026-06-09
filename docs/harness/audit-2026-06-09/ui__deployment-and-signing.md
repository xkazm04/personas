# UI Perfectionist — deployment-and-signing
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Two divergent status visual languages for the same DeployStatus concept
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/agents/sub_deployment/components/cloud/DeploymentCard.tsx:64-66
- **Scenario**: In the Deployments tab, a status chip shows just colored text — the raw lowercase token `active` / `paused` / `failed` with no icon. In the unified dashboard table the SAME status renders with an icon plus a Title-Case localized label (`statusBadge()` + `statusIcon()` in DeploymentTable.tsx:113-116). A user moving between the two surfaces sees one deployment described two different ways.
- **Root cause**: `DeploymentCard` calls `statusColor()` (cloudDeploymentHelpers.ts:25-36) which returns color classes only and renders `{d.status}` verbatim, while the table path uses the richer `statusBadge`/`statusIcon`/`tokenLabel` pipeline (DeploymentSubComponents.tsx:13-20). The two badge renderers were never unified.
- **Impact**: inconsistency
- **Fix sketch**: Extract a single `<DeploymentStatusBadge status={mappedStatus} />` (icon + localized label + chip classes) into DeploymentSubComponents and consume it in BOTH DeploymentCard and DeploymentTable. Map `d.status` through `mapCloudStatus` first so the card stops printing raw API tokens.

## 2. Card status badge is color-only — fails color-not-only for distinguishing failed vs active
- **Severity**: critical
- **Category**: accessibility
- **File**: src/features/agents/sub_deployment/components/cloud/cloudDeploymentHelpers.ts:25-36
- **Scenario**: On the deployment card, `active` (emerald) and `failed` (red) badges are identical pill shapes differing ONLY by hue and the small word inside. A red/green color-blind user (or anyone on a dim panel) cannot tell a healthy deployment from a crashed one at a glance — and the inner text is the raw token, not a clearly distinct word.
- **Root cause**: `statusColor()` returns only background/border/text color classes; unlike `statusIcon()` (DeploymentSubComponents.tsx:13-20) it carries no shape/icon channel, so color is the sole differentiator on the card surface.
- **Impact**: inaccessible
- **Fix sketch**: Have the card badge include the matching `statusIcon()` glyph (CheckCircle2 / PauseCircle / XCircle) alongside the label, identical to the table — restoring a non-color channel. Folding this into the shared badge from finding 1 fixes both at once.

## 3. Failed-deploy has no inline error state — deploy errors are swallowed
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/agents/sub_deployment/components/cloud/CloudDeploymentsPanel.tsx:58-64
- **Scenario**: A user picks a persona, clicks Deploy, the spinner runs, then... nothing. If the deploy throws (budget rejected, quota, network), `handleDeploy` routes the error to `silentCatch` and the form silently resets `isDeploying`. No message appears near the Deploy button; the user assumes it worked or is confused why the list didn't change.
- **Root cause**: The deploy flow has only two visual states (idle / `isDeploying`) and a parent-level `ErrorBanner` at the bottom of CloudDeployPanel.tsx:264 that is far from the action and tied to store `cloudError`, not to this form's attempt. There is no per-form error slot.
- **Impact**: error-blind
- **Fix sketch**: Capture the caught error into local state and render an inline error row directly beneath the Deploy button (reuse the same red `bg-red-500/10 border-red-500/20` treatment already used for failed test results), clearing it on the next attempt.

## 4. No "deploying" in-progress status in the unified table despite the contract anticipating it
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/agents/sub_deployment/components/deploymentTypes.ts:33-41
- **Scenario**: While a deployment is being created/provisioned it never appears as in-progress in the dashboard table — a freshly triggered deploy either is absent or lands as a grey `unknown` badge with `AlertCircle` (DeploymentSubComponents.tsx:18), reading like an error/forward-compat fallback rather than "spinning up". There is no visual language for an active transition.
- **Root cause**: `DeployStatus` has no `deploying`/`pending` member and `mapCloudStatus` collapses everything non-terminal to `unknown`; the table's busy state (`busyId`) only covers row actions, not the deployment lifecycle.
- **Impact**: error-blind
- **Fix sketch**: Add a `deploying` (or `pending`) variant with a spinner/Loader2 icon and a neutral-blue chip, map it in `mapCloudStatus`, and surface it in `statusIcon`/`statusBadge` so a transition reads as motion, not as the grey unknown fallback.

## 5. Health column mixes three uncoordinated empty/loading fallbacks and the sparkline has no legend
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/agents/sub_deployment/components/DeploymentTable.tsx:121-130
- **Scenario**: The Health cell shows the localized `loading` word for cloud rows, a bare `-` for GitLab rows, and (inside the sparkline) yet another `no_data` string — three different treatments for "nothing to show". When data exists, three thin overlapping lines (success/volume/errors) appear with no labels or legend, so the user cannot tell which line means what or whether green-line-down is good or bad.
- **Root cause**: The loading/empty branch is inlined per call site instead of a shared skeleton, and `DeploymentHealthSparkline` (DeploymentHealthSparkline.tsx:106-127) relies solely on tooltip titles for line identity.
- **Impact**: confusion
- **Fix sketch**: Use one consistent placeholder (a small skeleton bar) for loading and one `-`/`no_data` treatment for empty across both targets; add tiny colored dot legends or a single-letter prefix (S/V/E) beside the three sparklines so each line is self-identifying without hover.

## 6. Destructive remove/undeploy action carries the same visual weight as benign actions and fires with no confirmation
- **Severity**: high
- **Category**: visual-hierarchy
- **File**: src/features/agents/sub_deployment/components/cloud/DeploymentCard.tsx:107-116
- **Scenario**: The Trash2 (remove deployment) button sits in the same icon row as Test/Pause/Resume, at identical size (`p-1.5`, `w-3.5`) and weight, distinguished only by a red hover tint. One click immediately undeploys with no confirm step. The same equal-weight pattern repeats in the table (DeploymentTable.tsx:195-212) and reuses the generic `ActionButton`. The primary positive action (Deploy) is a strong filled indigo button, but the most destructive action is visually the quietest.
- **Root cause**: Destructive and non-destructive icon actions share one `ActionButton` style with destructiveness encoded only in `hoverColor`; there is no persistent destructive affordance and no confirm gate before an irreversible undeploy.
- **Impact**: confusion
- **Fix sketch**: Give remove a persistent (not hover-only) muted-red resting tint to separate it from benign icons, place it last with a small gap/divider, and gate it behind an inline confirm (a two-step "click to confirm" or a small popover) so an irreversible undeploy is never a single misclick.
