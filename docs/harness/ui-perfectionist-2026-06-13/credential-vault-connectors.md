# UI Perfectionist — credential-vault-connectors

> Total: 9 findings (0 critical, 5 high, 3 medium, 1 low)

Scope: `src/features/vault/sub_credentials` + `src/features/vault/sub_catalog`. Status presentation and secret-field UX judged against the catalog (`StatusBadge`/`StatusDot`, `PasswordToggleField`, `ErrorBanner`) and `statusTokens`. Notably, `HealthcheckResultDisplay.tsx` already uses `bg-status-success/*` / `text-status-error` tokens correctly — which makes the raw-color deviations elsewhere in the same surface read as inconsistent rather than intentional.

## 1. Secret fields hand-roll show/hide instead of PasswordToggleField
- **Severity**: high
- **Category**: reuse
- **File**: src/features/vault/sub_credentials/components/forms/FieldCaptureRow.tsx:116-129 (toggle state at :61, :88-89)
- **Problem**: Every credential secret (API keys, passphrases, OAuth secrets) is entered through a bare `<input type={isSecret && !isVisible ? 'password' : ...}>` with a manually wired `isVisible` state and an external eye button in `FieldActionButtons`. The catalog ships `PasswordToggleField` precisely for this, and it carries security behavior this hand-roll lacks: an 8s auto-mask-after-blur that caps shoulder-surf exposure, plus consistent `pr-10` padding so text never collides with the icon. This is the secret-field surface that matters most in the vault, and it silently diverges from the app-wide primitive.
- **Fix sketch**: Render `PasswordToggleField` (from `@/features/shared/components/forms/PasswordToggleField`) for the `password` branch instead of the raw input + custom toggle; drop the local `isVisible`/`setIsVisible` plumbing. Keep `ThemedSelect` and the text/url input branches as-is.

## 2. HealthBadge hand-rolls status pills instead of StatusBadge / statusTokens
- **Severity**: high
- **Category**: token
- **File**: src/features/vault/sub_credentials/components/list/CredentialListColumns.tsx:16-40
- **Problem**: The credential list's primary status signal (healthy / failing / untested) is built from raw `bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 ...` and `bg-red-600/15 ...` pills — duplicating, with subtly different opacities and a light/dark fork, what `StatusBadge` (`variant="success"|"error"|"neutral"`) and `statusTokens` already centralize. Status color is supposed to have a single source of truth; this is the canonical place it leaks.
- **Fix sketch**: Replace the three branches with `StatusBadge` (`success`/`error`/`neutral`, `icon={<CheckCircle2/XCircle/HelpCircle/>}`) so color, border, and dark-mode parity come from the token map, not local literals.

## 3. VaultErrorBanner re-implements the ErrorBanner catalog component
- **Severity**: high
- **Category**: reuse
- **File**: src/features/vault/sub_credentials/components/card/banners/VaultErrorBanner.tsx:10-26
- **Problem**: This is a hand-built inline/banner error block with its own dismiss button — exactly what catalog `ErrorBanner` ("inline / banner / panel variants with retry + dismiss") provides. The dismiss button also uses raw `text-red-400/60 hover:text-red-400` rather than the error token, and has no `focus-ring` / `aria-label`.
- **Fix sketch**: Replace with `ErrorBanner` (variant `inline`/`banner`, `onDismiss`), inheriting its tokenized styling, focusable labeled dismiss, and `role="alert"`. Delete the bespoke wrapper.

## 4. ReauthBanner uses raw amber literals instead of the warning status token
- **Severity**: high
- **Category**: token
- **File**: src/features/vault/sub_credentials/components/card/banners/ReauthBanner.tsx:94-130
- **Problem**: The whole banner is built from raw `bg-amber-600/10 border-amber-500/25 text-amber-300` plus `text-amber-400/60 hover:text-amber-400` action/dismiss colors. This is a warning-severity surface that should derive from `statusTokens.warning` (or `StatusBadge`/`ErrorBanner`'s warning variant). The ad-hoc opacities (`/10`, `/25`, `/60`) won't match the amber used by `ScopeMismatchBanner` (`/8`, `/20`) in the same card, so two warnings sit side by side at different tints.
- **Fix sketch**: Drive container + text from `statusTokens.warning` (`bg`/`border`/`text`/`icon`); give the dismiss/reconnect buttons `focus-ring`. Ideally adopt `ErrorBanner` in a warning variant so the dedupe + retry affordance is shared.

## 5. ConnectionTest button encodes pass/fail with raw emerald/amber, not tokens
- **Severity**: medium
- **Category**: token
- **File**: src/features/vault/sub_credentials/components/forms/ConnectionTestSection.tsx:36-40
- **Problem**: The test button flips between `bg-emerald-500/10 ... text-emerald-400` and `bg-amber-500/10 ... text-amber-300` to signal last-result state using raw literals, while the result panel below it (`HealthcheckResultDisplay`) correctly uses `status-success`/`status-error`. Same surface, two color systems.
- **Fix sketch**: Source the success/idle styles from `statusTokens.success` / `statusTokens.warning` (or use `Button` with an accent), matching the tokenized result panel.

## 6. Custom hover tooltip instead of the Tooltip component
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/vault/sub_credentials/components/forms/ConnectionTestSection.tsx:50-68
- **Problem**: The "test hint" is a hand-built `onMouseEnter/onMouseLeave` + absolutely-positioned div tooltip. The catalog `Tooltip` (already used in `ConnectorCard.tsx`) handles positioning, focus/keyboard reveal, and touch. The hand-roll is mouse-only (no focus reveal) and the trigger button has no `aria-label`.
- **Fix sketch**: Wrap the `Info` button in `Tooltip content={testHint}` and delete the `showTestHint` state and the absolute div.

## 7. CompositeHealthDot uses a raw dot + title= instead of StatusDot
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/vault/sub_credentials/components/card/badges/CompositeHealthDot.tsx:23-28
- **Problem**: A bare `<span class="w-1.5 h-1.5 rounded-full ...">` conveys credential health by color alone, with the detail buried in a native `title=`. Catalog `StatusDot` exists specifically to pair each state with a distinct shape silhouette (WCAG 1.4.1, ~8% color-blind users) and an sr-only label — this hand-roll fails that on the vault's at-a-glance health indicator. The `title=` is also not keyboard-reachable.
- **Fix sketch**: Use `StatusDot` (`kind="severity"`, mapped state + i18n `label`) for shape + a11y; if the rich score/reason text must remain, wrap it in `Tooltip` rather than `title=`.

## 8. ScopeMismatchBanner uses raw amber literals
- **Severity**: low
- **Category**: token
- **File**: src/features/vault/sub_credentials/components/card/banners/ScopeMismatchBanner.tsx:26-44
- **Problem**: Same warning-surface raw-amber issue as #4, at a different tint (`bg-amber-500/8`, `text-amber-300/90`, `text-amber-300/60`). The reauthorize link is also a raw underlined text button without `focus-ring`.
- **Fix sketch**: Derive container/text from `statusTokens.warning`; add `focus-ring` to the reauthorize button. Aligning #4 and #8 to one token removes the two-tint mismatch.

## 9. StatCard hand-rolls a SectionCard-style panel
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/vault/sub_credentials/components/features/IntelligenceStatCard.tsx:9-19
- **Problem**: A bespoke `bg-secondary/20 border border-primary/10 rounded-modal` stat tile re-implements the grouped-content panel pattern the catalog standardizes (`SectionCard`, and `Numeric` for the value which is currently a pre-formatted `string` with `tabular-nums`). The ad-hoc border/bg won't track the elevation/rounding the rest of the app's cards share.
- **Fix sketch**: Build the tile from `SectionCard` (or the shared stat-tile primitive if one exists in CATALOG); render the value via `Numeric` so number formatting and tabular alignment are consistent.
