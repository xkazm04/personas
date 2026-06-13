# UI Perfectionist — settings-api-keys-byom (2026-06-13)

> Total: 10 findings (0 critical, 5 high, 4 medium, 1 low)

Scope: `sub_api_keys`, `sub_byom`, `sub_engine`, `sub_portability`. Judged against the shared design system (199-component catalog, statusTokens, ROW_SEPARATOR, focus-ring). Note: several files already adopt the system well (`PasswordToggleField`, `AsyncButton`, `EmptyState`, `AccessibleToggle`, `LoadingSpinner`, `SegmentedTabs`) — findings below are the remaining deviations.

---

## 1. Three different Save-button visual languages across BYOM / portability / engine
- **Severity**: high
- **Category**: reuse
- **File**: ByomSettings.tsx:62-85; ExportSection.tsx:57-116; CredentialPortability.tsx:85-145; DataPortabilitySettings.tsx (header buttons)
- **Problem**: Every primary/secondary action is a hand-rolled `<button>` with bespoke `bg-primary/25 … border-primary/40`, `bg-amber-500/10`, `bg-blue-500/10`, `bg-emerald-500/10` color combos and inline disabled/hover logic. ApiKeysSettings and CreateApiKeyDialog already use the catalog `AsyncButton`/`Button`, so the same screen family ships two button systems — the BYOM Save button's five-way conditional className (error/saving/dirty/clean) is especially un-scannable and reinvents loading + disabled states the catalog button already owns.
- **Fix sketch**: Replace the raw buttons with `Button`/`AsyncButton` from `@/features/shared/components/buttons` (`variant="primary|secondary|ghost"`, `isLoading`, `disabled`). The colored export/import buttons should use a single accent variant rather than per-action amber/blue/emerald tints.

## 2. ApiKey rows and BYOM key rows hand-roll the settings row instead of `SettingRow`
- **Severity**: high
- **Category**: reuse
- **File**: ApiKeysSettings.tsx:250-341 (ApiKeyRow); ByomApiKeyManager.tsx:277-414 (KeyEntryRow)
- **Problem**: Both are label + description + meta + trailing-action rows — exactly what `SettingRow` standardizes (one consistent type ramp shared across setup panels). Instead each invents its own padding (`px-3 py-2.5` vs `p-3`), border (`border-border/30` vs `border-primary/10`), and background, so the two key-management surfaces in the same Settings area don't visually match. Row separators are ad-hoc borders rather than the `ROW_SEPARATOR` token.
- **Fix sketch**: Adopt `SettingRow` (or a shared row wrapper) for both; pull the row border from `listTokens.ROW_SEPARATOR` so API-key and BYOM-key rows read as one system.

## 3. Status colors hard-coded instead of `statusTokens` (systemic across the scope)
- **Severity**: high
- **Category**: token
- **File**: ApiKeysSettings.tsx:156,263,269,302,323; ByomApiKeyManager.tsx:355,408,428,439,447; ByomProviderList.tsx:228,236,264,269,320-321,368,380; EngineSettings.tsx:82-86,117-133; OperationRow.tsx:51,63-72; ByomSettings.tsx:99-140
- **Problem**: Raw `text-emerald-400 / bg-emerald-500/10`, `text-red-400 / bg-red-500/10`, `text-amber-400 / bg-amber-500/10`, `text-rose-400/60` appear dozens of times for success/error/warning states. The reference names `statusTokens.ts` as the single source of truth; this volume of hand-mixed status colors means a theme/contrast change can't be made in one place and the same "error" reads at slightly different opacities (`/10` vs `/15`, `/60` vs `/40`) across rows.
- **Fix sketch**: Map success/warning/error/info through `statusTokens` (text/bg/border classes) and use `StatusBadge`/`StatusDot`/`LiveStatusDot` for the connection/health pills (ConnectionBadge, HealthDot, TestConnectionButton pass/fail) instead of bespoke spans.

## 4. Inline SVG check/cross icons instead of lucide icons used everywhere else
- **Severity**: medium
- **Category**: polish
- **File**: ByomProviderList.tsx:369-371 and 381-383
- **Problem**: The pass/fail result in `TestConnectionButton` embeds raw 16×16 `<svg><path>` check and X glyphs, while the entire rest of the scope uses lucide `Check`/`X`/`AlertTriangle` at consistent stroke weight. The inline SVGs are filled (not stroked) so they render visually heavier than neighboring lucide icons, breaking icon consistency.
- **Fix sketch**: Replace the inline `<svg>` with lucide `CheckCircle2` / `XCircle` (or `Check`/`X`) at `w-3.5 h-3.5`, colored via `statusTokens`.

## 5. Raw text/url inputs not wrapped in `FormField` / `DesignInput`
- **Severity**: high
- **Category**: reuse
- **File**: CreateApiKeyDialog.tsx:96-109 (name input); ByomApiKeyManager.tsx:321-334 (LiteLLM URL input)
- **Problem**: The "Key name" field hand-builds `<label>` + `<input>` + hint `<p>` with bespoke focus classes, and the URL field is a raw `<input type="url">` with its own border/focus styling. The catalog provides `FormField` (label + hint + error wrapper) and `DesignInput` for exactly this; the surrounding password fields already use `PasswordToggleField`, so the name/URL fields are the odd ones with no shared focus-ring or error slot. The URL field's validation error (ByomApiKeyManager.tsx:149-155) only flips a badge — no inline field error message.
- **Fix sketch**: Wrap both in `FormField` and use `DesignInput`; surface the URL validation failure as the FormField `error` prop rather than a transient `connectionState: 'error'` badge.

## 6. API-key scope picker uses fake-checkbox buttons instead of catalog toggles/checkboxes
- **Severity**: medium
- **Category**: reuse
- **File**: CreateApiKeyDialog.tsx:117-146 (scopes); CreatedKeyDialog.tsx:175-182 (acknowledge checkbox)
- **Problem**: The scope selector renders a `<button>` containing a `readOnly` `<input type=checkbox tabIndex={-1}>` — a decorative checkbox that isn't actually focusable or operable as a checkbox, and the acknowledge control is a raw native `<input type=checkbox className="accent-primary">`. The catalog offers `AccessibleToggle` / a real checkbox component; the readOnly-decorative pattern is an a11y/consistency smell (screen readers see an inert checkbox).
- **Fix sketch**: Use a real catalog checkbox for the acknowledge control, and for scopes use selectable list rows backed by an accessible checkbox/`AccessibleToggle` rather than a button-wrapping-a-dead-checkbox.

## 7. CreateApiKeyDialog is a hand-built modal; CreatedKeyDialog hand-rolls copy buttons
- **Severity**: medium
- **Category**: reuse
- **File**: CreateApiKeyDialog.tsx:73-92 (modal shell, close button); CreatedKeyDialog.tsx:140-164 (copy buttons), McpServerInfoPanel.tsx:69-85 (copy button)
- **Problem**: `CreateApiKeyDialog` builds its own backdrop + panel + header + close `<button>` rather than the shared modal primitive used elsewhere (note `CreatedKeyDialog`/`ExportSelectionModal` exist as modals too — three different modal shells). Separately, three places hand-roll copy-to-clipboard with `copyText` + local `copied` state + manual Copy/Check swap, when the catalog `CopyButton` provides exactly this with built-in feedback.
- **Fix sketch**: Build `CreateApiKeyDialog` on the shared modal component (consistent header/close/focus trap). Replace the manual copy buttons in CreatedKeyDialog and McpServerInfoPanel with `CopyButton`.

## 8. Loading / empty / error states bypass catalog feedback components
- **Severity**: high
- **Category**: state-coverage
- **File**: ApiKeysSettings.tsx:155-189 (error div + text-only loading + empty); ByomApiKeyManager.tsx:212-218 (bare `Loader2` centered); EngineSettings.tsx:30-35 (text-only loading); DataPortabilitySettings.tsx:46-48 (`<p>` error)
- **Problem**: Async surfaces use inconsistent ad-hoc states: API keys shows a custom red error banner + plain-text "loading"/"empty" strings (no `EmptyState`/`ErrorBanner`/skeleton); BYOM key manager shows a lone spinning `Loader2`; engine shows a centered text string; portability stats error is a bare red `<p>`. `ByomProviderList` already uses `EmptyState` and portability uses `LoadingSpinner`, proving the components are available — the other surfaces just don't use them, so the loading/empty/error experience is uneven across one Settings area.
- **Fix sketch**: Use `ErrorBanner` (with its built-in retry) for the API-keys and stats errors, `EmptyState` for the empty key list, and `ListSkeleton`/`LoadingSpinner` consistently for loading.

## 9. Engine capability matrix toggles + provider chips are hand-built, not catalog
- **Severity**: medium
- **Category**: reuse
- **File**: OperationRow.tsx:59-74 (toggle cells); EngineSettings.tsx:82-88 (installed/missing chips)
- **Problem**: Each matrix cell is a 24px `<button>` with bespoke emerald/rose backgrounds acting as a toggle, and installed/missing state is a hand-styled `text-[10px]` pill. These reimplement toggle + status-badge semantics; the `text-[10px]` provider chip and `text-[11px]` description (OperationRow.tsx:31) also fight the typography ramp with off-ramp pixel sizes.
- **Fix sketch**: Render installed/missing via `StatusBadge`/`Badge` (status token driven). Keep the compact toggle cell but source its colors from `statusTokens`, and replace `text-[10px]`/`text-[11px]` with the nearest `typo-caption` ramp class.

## 10. `title=` used where `Tooltip` belongs, and a stray hardcoded English `title="Copy value"`
- **Severity**: low
- **Category**: a11y
- **File**: ByomApiKeyManager.tsx:404-406 (`title="Copy value"`, eslint-disabled hardcoded text); ApiKeysSettings.tsx:271,303,326 (`title=` on action buttons); OperationRow.tsx:52,66 (`title=` for the only label of icon-only cells)
- **Problem**: Icon-only controls rely on native `title=` tooltips (inconsistent delay, not theme-styled) where the catalog `Tooltip` is the standard, and the BYOM copy button hardcodes an untranslated `"Copy value"` string (with an eslint suppression) while the rest of the file is i18n'd — a visible inconsistency for non-English locales.
- **Fix sketch**: Wrap icon-only actions in the catalog `Tooltip`; route the copy label through `t.settings.byom` and drop the eslint-disable. Prefer `CopyButton` (finding 7) which carries its own accessible label.
