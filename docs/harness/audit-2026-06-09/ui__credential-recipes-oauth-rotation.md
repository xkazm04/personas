# UI Perfectionist — credential-recipes-oauth-rotation
> Total: 6
> Severity: 0 critical, 2 high, 3 medium, 1 low

> Scope note: The credential "recipe" surface in `src/features/vault` is the AI-guided **negotiator wizard** (`sub_catalog/components/negotiator/*`) plus auto-setup (`CatalogAutoSetup`). That wizard is well-built (live regions, `aria-current="step"`, focus management on step transitions, numbered step indicators, password capture via `FieldCaptureRow`), so findings there are minimal. Two playground files — `RecipeListItem.tsx` and `RecipeCreateFlow.tsx` — exist under `shared/playground/tabs/` but are **not imported anywhere in the repo** (verified via repo-wide grep). They are the literal "credential recipe list/create" components, so they are audited below but flagged as orphaned. OAuth + rotation surfaces are live and carry the higher-value findings.

## 1. OAuth section has no "expired / failed" status — only connect & success states
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/vault/sub_credentials/components/forms/OAuthSection.tsx:18-86
- **Scenario**: A user whose OAuth grant was revoked (or whose authorize attempt failed) opens the credential's Authentication section. They see the same blue "Authorize with Google" button as a brand-new credential, with no expired/needs-reconnect treatment inline. `deriveRingPhase` only models `waiting | polling | success | null` — there is no failure branch, so a failed `pollingMessage` (`success: false`) silently falls through to `null` and just re-renders the plain authorize button with no error text.
- **Root cause**: The status visual language is incomplete. The revoked/expired state is handled in a *separate* component (`ReauthBanner`, a global toast-style banner) but the inline Authentication block has no expired affordance, and the OAuth flow's own failure result is never rendered.
- **Impact**: error-blind — a failed authorization looks identical to "not yet started", and an expired credential gives no inline signal at the point of action.
- **Fix sketch**: Add an `expired`/`error` phase. When `pollingMessage?.success === false`, render a red-bordered inline message (mirroring `CredentialRotationSection`'s action-error banner at lines 95-103) above the authorize button, and relabel the button to "Reconnect" with an amber/red accent when the credential is in a revoked state.

## 2. OAuthSection hardcodes English strings while the whole module is i18n-driven
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/vault/sub_credentials/components/forms/OAuthSection.tsx:48,72
- **Scenario**: With a non-English locale active, the section heading renders literal "Authentication" (line 48) and the fallback button text renders literal "Authorize with Google" (line 72) when no `consentLabel` prop is supplied — surrounded by correctly translated sibling text.
- **Root cause**: These two strings bypass `useTranslation()` / `t.vault.*`, unlike every neighboring vault component (e.g. `RotationNewPolicy`, `NegotiatorPanel`, `PendingAuthModal` all read from `t.vault.*`). The component does not even import `useTranslation`.
- **Impact**: inconsistency — untranslated UI fragments break locale coverage and look like a regression in non-EN builds.
- **Fix sketch**: Import `useTranslation` and replace the heading with `t.vault.forms.authentication` (the namespace already exists — `OAuthProgressRing` reads `t.vault.forms.authorization_complete`), and make the button fallback `consentLabel || t.vault.forms.authorize_default`.

## 3. Duplicated rotation period-selector markup across new/active policy components
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/vault/sub_credentials/components/features/RotationNewPolicy.tsx:36-62
- **Scenario**: The "Rotate every [pills + custom days input] days" control is rendered identically in `RotationNewPolicy.tsx` (lines 36-62) and `RotationActivePolicy.tsx` (lines 113-137) — same `PillGroup`, same preset arrays `(isOAuth ? [1,7,30,90] : [30,60,90,180])`, same custom `<input type="number">`, same surrounding labels. Any tweak (e.g. adding a 365-day option) must be made in two places, risking drift between the create and edit flows.
- **Root cause**: No shared `RotationPeriodPicker` component; the preset list and number-input affordance are copy-pasted.
- **Impact**: inconsistency — two sources of truth for the same control invite divergence (the OAuth preset branch is already a magic literal duplicated verbatim).
- **Fix sketch**: Extract a `RotationPeriodPicker({ value, onChange, isOAuth, layoutId })` colocated with the rotation features folder; both components consume it. Centralizes the preset arrays and the custom-input styling.

## 4. Rotation custom-days number input has no accessible label
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/vault/sub_credentials/components/features/RotationNewPolicy.tsx:46-57
- **Scenario**: A screen-reader / keyboard user tabs into the custom rotation-interval `<input type="number">` (also at `RotationActivePolicy.tsx:125-133`). It announces only "spin button, edit" — there is no `aria-label`, no associated `<label>`, and the visible "Rotate every … days" text is split into two separate `<span>`s on either side, neither linked to the field via `htmlFor`/`id`.
- **Root cause**: The field relies purely on adjacent visual text; it has a `data-testid` but no programmatic name.
- **Impact**: inaccessible — the most security-sensitive numeric control in the rotation flow is unlabeled for assistive tech.
- **Fix sketch**: Add `aria-label={t.vault.rotation_section.rotate_every_days_aria}` (or wire the surrounding text via `aria-labelledby` referencing the two spans' ids) to both custom number inputs.

## 5. OAuthProgressRing uses Math.random() for its SVG gradient id
- **Severity**: medium
- **Category**: polish
- **File**: src/features/vault/sub_credentials/components/forms/OAuthProgressRing.tsx:36-39
- **Scenario**: The animated OAuth ring derives its `<linearGradient>` id from `Math.random()` memoized once per mount. The gradient renders fine, but the id is non-deterministic and not React's sanctioned unique-id mechanism; the codebase already standardizes on `useId()` elsewhere (e.g. `SchemaFormFields.tsx`, `CliConnectionPanel.tsx`, `InteractiveSetupInstructions.tsx`).
- **Root cause**: Reinventing unique-id generation instead of `useId()`, which is the established pattern for SVG def ids in this repo and is collision-proof + hydration-stable.
- **Impact**: unpolished — inconsistent with the project's own id convention; random ids also defeat any future server render / snapshot-test determinism.
- **Fix sketch**: Replace the `useMemo(() => oauth-ring-${Math.random()...})` with `const gradientId = useId();` (React 19 is in the stack) and use it directly.

## 6. Orphaned RecipeListItem actions lack accessible names and expand state
- **Severity**: low
- **Category**: accessibility
- **File**: src/features/vault/shared/playground/tabs/RecipeListItem.tsx:27-63
- **Scenario**: In the (currently unwired) credential recipe list row, the chevron expand/collapse button (lines 27-36) and the trash/delete button (lines 58-63) are icon-only with no `aria-label` and no `title`; the toggle has no `aria-expanded`. The settings button at least has a `title`. A keyboard/SR user hears only "button". (Reported low because the component is not currently mounted anywhere — verified by repo grep — but it is the canonical credential-recipe list UI and will regress if wired up as-is.)
- **Root cause**: Icon-only controls without text alternatives; toggle state not exposed.
- **Impact**: inaccessible (latent) — fails when/if the component is reintroduced into the recipe playground.
- **Fix sketch**: Add `aria-label` + `aria-expanded={isExpanded}` to the toggle button and `aria-label={sh.delete_recipe}` to the delete button (the negotiator step toggle and `ReauthBanner` dismiss already model this `aria-label` pattern). Consider deleting the file if the recipe-list feature is truly dead.
