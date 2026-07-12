> Context: vault/catalog [3/5]
> Total: 7
> Critical: 0  High: 0  Medium: 3  Low: 4

## 1. `btoa()` crashes healthcheck on non-Latin1 basic-auth credentials
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_catalog/components/schemas/schemaFormTypes.ts:84-88
- **Scenario**: A user creates a "basic" credential (registered in schemaConfigs.tsx:123 via `buildCustomHealthcheck('basic', values)`) whose username or password contains any non-Latin1 character (accented letters, emoji, most non-ASCII). When the healthcheck runs, `btoa(`${u}:${p}`)` throws `InvalidCharacterError` ("The string to be encoded contains characters outside of the Latin1 range").
- **Root cause**: `btoa` only accepts Latin1; credential values are arbitrary UTF-8. Unlike the `api-key`/`bearer`/`custom-headers` branches (which emit `{{template}}` placeholders and defer substitution), the `basic` branch eagerly base64-encodes real values with the raw `btoa`.
- **Impact**: Unhandled exception during "Test connection" for legitimate international credentials — the healthcheck path crashes instead of returning `{success:false}`.
- **Fix sketch**: Encode UTF-8 safely, e.g. `btoa(String.fromCharCode(...new TextEncoder().encode(`${u}:${p}`)))`, or build the Basic header from a bytes-aware base64 helper. Wrap in try/catch to degrade to a failed healthcheck rather than throw.

## 2. "I completed this step" button only mutates local state — no backend/automation signal
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/vault/sub_catalog/components/autoCred/display/AutoCredCards.tsx:63-69
- **Scenario**: During auto-credential capture a `WAITING:` log renders a prominent amber card asking the user to complete a manual step, with a "completed_step" button. Clicking it runs `onClick={() => setConfirmed(true)}` — it only collapses the card visually. `WaitingCard` receives no callback (`{ entry, isLatest }` are its only props), so nothing is sent to the backend/Playwright automation.
- **Root cause**: The affordance implies it resumes the paused automation, but there is no resume channel wired through this component.
- **Impact**: If the automation genuinely blocks on user acknowledgement, it stalls indefinitely while the UI says "done"; if it auto-detects instead, the button is misleading success theater.
- **Fix sketch**: Confirm whether the backend auto-detects completion. If it needs a signal, thread an `onConfirm(entry)` callback that pings the automation; if it truly is informational, relabel to "Dismiss" so it doesn't promise resumption.

## 3. `recoveryTips` re-implements raw English error-string matching already centralized in `ERROR_KEY_MAP`
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/phases/ErrorPhase.tsx:14-47
- **Scenario**: The component's own comment (lines 52-56) notes the friendly message + suggestion now come from `resolveErrorTranslated`/`ERROR_KEY_MAP`, yet `recoveryTips` still hand-matches the same raw backend substrings (`'Failed to extract connector design'`, `'timed out'`, `'Claude CLI not found'`) to pick tips. Two independent pattern tables must stay in sync with backend wording.
- **Root cause**: Tip selection was left behind when message resolution was centralized; it keys off brittle English substrings of an error that may itself be localized/reworded upstream.
- **Impact**: Maintainability — a backend error-string change silently drops the correct tips (fallback tips render instead) with no compile error to catch it.
- **Fix sketch**: Have `resolveErrorTranslated` (or the error registry) return a stable `errorKey`, and drive `recoveryTips` off that key instead of substring matching, so both message and tips share one source of truth.

## 4. `basic` healthcheck bakes literal credentials while sibling templates defer via `{{placeholders}}`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/schemas/schemaFormTypes.ts:75-94
- **Scenario**: Within `buildCustomHealthcheck`, `api-key`/`bearer`/`custom-headers` all emit template markers (`'{{api_key}}'`, `'Bearer {{bearer_token}}'`) that the healthcheck runner substitutes, but `basic` inlines the actual `values.username`/`values.password`. The one-off shape is what forces the eager `btoa` in finding #1 and means the returned `HealthcheckConfig.headers` carries plaintext-derived secrets.
- **Root cause**: Basic auth combines two fields into one header value, which the simple single-token placeholder scheme can't express, so it was special-cased with real values.
- **Impact**: Maintainability + minor secret-hygiene — the config object now holds real credential material that the other branches deliberately keep out.
- **Fix sketch**: Extend the substitution scheme to support a `{{basic_auth}}` (or two-token) marker computed by the runner, keeping all four branches placeholder-only.

## 5. `NegotiatorGuidingPhase` progress/allDone unclamped against `completedSteps` that can exceed visible steps
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/vault/sub_catalog/components/negotiator/NegotiatorGuidingPhase.tsx:50-53
- **Scenario**: `completedCount = completedSteps.size` and `progressPercent = (completedCount / totalSteps) * 100`, where `totalSteps = visibleSteps.length`. `completedSteps` is a parent-owned `Set<number>` of step indices. If a step is marked complete and the step graph later re-resolves it out of `visibleSteps` (skip), `completedCount` can exceed `totalSteps`, pushing the progress bar past 100% and flipping `allDone` (and the Apply button) on prematurely.
- **Root cause**: `completedCount` counts all completed indices, not just those still visible; nothing intersects the set with `visibleSteps`.
- **Impact**: UX — overfilled progress bar / early "Apply credentials" when the visible/skipped step set shifts mid-flow.
- **Fix sketch**: Compute `completedCount` as the count of `visibleSteps` whose index is in `completedSteps`, and clamp `progressPercent` with `Math.min(...,100)`.

## 6. `AnalyzingPhase` recomputes progress by hand instead of reusing `useStepProgress` output
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/phases/AnalyzingPhase.tsx:44-57
- **Scenario**: The component drives `useStepProgress` (which already exposes `progressPercent`, `completedCount`, `steps`) but then computes its own `progress = Math.min((derivedIdx / STAGE_KEYS.length) * 100, 100)` for the bar. Two progress notions coexist; the hook's `progressPercent` is derived from `completedCount` (lags one stage behind `derivedIdx`), so they can disagree, and the local formula is a maintenance duplicate.
- **Root cause**: `progressPercent` (based on completed set) doesn't match the desired "smooth 0->100 vs derivedIdx" so a parallel computation was added rather than surfacing a derived-progress value from the hook.
- **Impact**: Maintainability — two sources for the same visual, easy to drift.
- **Fix sketch**: Either read `sp.progressPercent` directly, or add a `derivedProgress` return to `useStepProgress` so the bar and the step list share one computation.

## 7. Cancel/secondary button Tailwind recipe duplicated across every phase component
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/phases/AnalyzingPhase.tsx:128; negotiator/NegotiatorGuidingPhase.tsx:118; design/phases/DonePhase.tsx:64; (repeats in NegotiatorPhases.tsx, ErrorPhase.tsx)
- **Scenario**: The identical secondary-button class string `px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-modal typo-body transition-colors` (and near-identical variants) is copy-pasted across at least four phase components in this context.
- **Root cause**: No shared secondary-button primitive is used here even though `@/features/shared/components/buttons` (`Button`) is already imported by ForagingResults.tsx in the same folder tree.
- **Impact**: Maintainability — restyling the cancel affordance requires editing many files; drift already visible (some add `border border-primary/15`, some don't).
- **Fix sketch**: Replace ad-hoc cancel buttons with the shared `Button variant="secondary"` (or a small `PhaseCancelButton`) to centralize the recipe.
