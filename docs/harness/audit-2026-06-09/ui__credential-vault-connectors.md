# UI Perfectionist — credential-vault-connectors
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. Secret show/hide toggle is an unlabeled icon button
- **Severity**: critical
- **Category**: accessibility
- **File**: src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:120-129
- **Scenario**: On every credential field that holds a secret (API keys, tokens, passwords) the masked-input reveal control renders only an `Eye`/`EyeOff` icon. A screen-reader user lands on a button announced as just "button" with no name; they cannot tell it toggles secret visibility, nor its current state.
- **Root cause**: The `<button>` for `setIsVisible` has only a `data-testid` and an icon child — no `aria-label`, no `aria-pressed`, no `title`. The copy/paste sibling buttons in the same component DO have `title` attributes, so the show/hide button is the lone unlabeled affordance among them.
- **Impact**: inaccessible
- **Fix sketch**: Add `aria-label={isVisible ? t.vault.credential_forms.hide_value : t.vault.credential_forms.show_value}`, `aria-pressed={isVisible}`, and a matching `title` to the toggle button (mirroring the copy button's `title` pattern). This is the single most-used secret affordance in the vault, so it warrants the highest priority.

## 2. FieldCaptureRow label is not programmatically tied to its input
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/vault/sub_credentials/components/forms/FieldCaptureRow.tsx:75-78, 95-127
- **Scenario**: Each captured secret/credential field shows a visible `<label>`, but clicking the label does not focus the input, and assistive tech does not associate the label text ("API Key", "Client Secret", etc.) with the field. The input/`ThemedSelect` therefore has no accessible name beyond its placeholder.
- **Root cause**: The `<label>` has no `htmlFor`, and the `<input>`/`ThemedSelect` have no `id`. `fieldId`/`errorId` are computed (line 59-60) and `errorId` is wired into `aria-describedby`, but `fieldId` is never applied to the control. The sibling `SchemaNameField` (sub_catalog/.../SchemaFormFields.tsx:40-59) uses `useId()` + `htmlFor`/`id` correctly, so this is an internal inconsistency between two field components doing the same job.
- **Impact**: inaccessible | inconsistency
- **Fix sketch**: Give the input/select `id={fieldId}` and the label `htmlFor={fieldId}`. Reuse the existing `fieldId` already derived in the component — no new state needed. Aligns the schema field and capture field on one labeling pattern.

## 3. Connector "owned/ready" status is encoded by color alone
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx:60-66, 152-173
- **Scenario**: In the catalog grid, a connector the user already has credentials for ("owned") is distinguished only by an emerald ring + emerald-tinted background; an un-owned connector uses the primary color. There is no text, icon, or checkmark indicating "connected/ready". Color-blind users and anyone scanning quickly cannot tell ready connectors from the rest — the readiness signal is purely chromatic.
- **Root cause**: `isOwned` only drives `ringClass`/`bgClass` (color), with no accompanying non-color indicator. Contrast with the desktop cards which DO pair color with an icon+label badge (`McpServerCard.tsx:31-35` and `DesktopAppCard.tsx:44-55` show a `CheckCircle2` "Imported/Installed" badge). The catalog card omits that same readiness language.
- **Impact**: error-blind | inconsistency
- **Fix sketch**: When `isOwned`, render a small `CheckCircle2` + localized "Connected" badge (reuse the emerald badge style already present for the recipe indicator at lines 142-149) so readiness is conveyed by icon+text, not only the ring color. Keep the ring as reinforcement.

## 4. Catalog grid has an empty state but no loading state, and empty markup diverges from desktop lists
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/vault/sub_catalog/components/picker/PickerGrid.tsx:20-44
- **Scenario**: While connector definitions are still resolving, the grid renders an empty `<div className="grid …">` (nothing). The user briefly sees a blank panel with no skeleton or spinner. Separately, when filters match nothing, PickerGrid uses the shared `EmptyIllustration`, but the parallel desktop discovery lists (`DiscoveryMcpList.tsx:48-57`, `DiscoveryAppList.tsx:78-82`) render ad-hoc centered `<p>` blocks for their empty states — three different empty-state treatments across the same vault feature.
- **Root cause**: PickerGrid renders the grid unconditionally and only branches on `filteredConnectors.length === 0`; there is no loading prop/skeleton. The desktop lists never adopted `EmptyIllustration`, so empty-state styling is inconsistent across the catalog.
- **Impact**: unpolished | inconsistency
- **Fix sketch**: (a) Add a loading branch to PickerGrid that renders a small grid of skeleton cards (or the shared spinner) matching the `minmax(9rem,1fr)` cell size. (b) Replace the bespoke centered `<p>` empty blocks in DiscoveryMcpList/DiscoveryAppList with `EmptyIllustration` so all three catalog surfaces share one empty-state component.

## 5. VaultErrorBanner dismiss control is hardcoded English and unlabeled, unlike the sibling banners
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/vault/sub_credentials/components/card/banners/VaultErrorBanner.tsx:17-24
- **Scenario**: The vault error banner's dismiss control is a text button reading the literal English string "Dismiss" with no icon. The neighboring `ReauthBanner` (ReauthBanner.tsx:66-72) and `ScopeMismatchBanner` use a localized `X`-icon dismiss with `aria-label={t.common.dismiss}`. Three error/warning banners in the same folder present "dismiss" three different ways, and one ships untranslated.
- **Root cause**: VaultErrorBanner was written with an inline string and no translation/aria wiring, while the OAuth banners use the `t.common.dismiss` token + `X` icon + `aria-label`. No shared dismiss-button primitive.
- **Impact**: inconsistency | inaccessible
- **Fix sketch**: Replace the text "Dismiss" with the `X`-icon button used by ReauthBanner, add `aria-label={t.common.dismiss}`, and pull the label from translations. Better, extract a single `BannerDismissButton` and use it across all three vault banners.

## 6. "captured" confirmation pill is a hardcoded, untranslated string
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:114-119
- **Scenario**: When a field is in `confirming` mode and has a value, a green pill reads the literal lowercase English word "captured". Every other label in this component and in FieldCaptureRow comes from `t.vault.*` translations, so in a non-English locale this single pill stays in English and breaks visual/text consistency.
- **Root cause**: The string is hardcoded inline (`captured`) instead of a translation key, and it is lowercase while comparable status chips (e.g. `HealthBadge` in CredentialListColumns.tsx:16-39) use sentence-case localized labels.
- **Impact**: inconsistency | unpolished
- **Fix sketch**: Replace the literal with a translation token (e.g. `t.vault.credential_forms.captured`) and match the casing convention of the other status chips. While here, give the pill the same `typo-caption`/badge styling family as `HealthBadge` for a consistent status-chip visual language.
