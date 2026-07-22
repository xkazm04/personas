# vault/credentials [4/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 10 | Missing: 0

## 1. ScopeMismatchBanner is dead code (no importers anywhere in src/)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/card/banners/ScopeMismatchBanner.tsx:11
- **Scenario**: A repo-wide grep for `ScopeMismatchBanner` finds only the definition file (plus context-map/lint/doc artifacts) — no import or JSX usage in any source file. The component ships and rots: its i18n keys (`t.vault.card.scope_mismatch`, `scope_missing_one/other`, `reauthorize_scopes`) and its scope-diff logic are maintained for nothing.
- **Root cause**: The banner was presumably built for the credential card during an earlier UI pass (it appears in the 2026-06-09/06-13 audit docs) but was never wired into the card, or its call site was removed. The already-stubbed `providerLabel: _providerLabel` prop (declared, renamed to underscore, never used) is a second sign of decay in the same file.
- **Impact**: Dead component + dead prop + likely-orphaned i18n keys inflate the vault surface area and mislead future scans ("scope mismatch is handled" — it isn't rendered anywhere).
- **Fix sketch**: Confirm with a final grep (including any dynamic `lazy(() => import(...))` patterns — none found), then either delete the file and prune the four `t.vault.card.scope_*`/`reauthorize_scopes` keys if unused elsewhere, or — if OAuth scope-drift detection is still wanted — wire it into the credential card where granted scopes are known. If keeping, drop the unused `providerLabel` prop from the interface.

## 2. CompositeHealthDot is dead code (no importers anywhere in src/)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/card/badges/CompositeHealthDot.tsx:11
- **Scenario**: Repo-wide grep for `CompositeHealthDot` matches only its own file (plus context-map/lint/doc artifacts). No component renders it, and there is no barrel re-export from the badges directory.
- **Root cause**: The composite health-score dot was superseded or never integrated; `computeHealthScore`/`getTierStyle` from `credentialHealthScore` remain the live logic used elsewhere, while this thin visual wrapper was orphaned.
- **Impact**: Maintenance hazard: it carries a hardcoded English string (`' (from previous session)'`) in an otherwise i18n-translated feature, so anyone "fixing" its i18n or styling is polishing unreachable code.
- **Fix sketch**: Verify `computeHealthScore`/`getTierStyle` have other callers (they do — keep the util), then delete `CompositeHealthDot.tsx`. If a composite dot is still desired on credential cards, resurrect it at the call site with a translated stale-note string.

## 3. VaultErrorBanner hardcodes the English "Dismiss" label in an i18n'd feature
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/vault/sub_credentials/components/card/banners/VaultErrorBanner.tsx:22
- **Scenario**: Every other component in this context pulls strings through `useTranslation()` (breadcrumb aria-label, setup-guide title, scope banner copy), but this banner — used in CredentialManager, PreviewPhase, and playground OverviewTab — renders a literal `Dismiss`.
- **Root cause**: The dismiss affordance was added without routing the label through the translation catalog.
- **Impact**: Non-English locales show a mixed-language error banner on a component that appears in at least three live surfaces; it also fails any catalog-parity check for the vault namespace.
- **Fix sketch**: Add a `dismiss` key under the vault (or shared/common) namespace and replace the literal with `t.…dismiss` via `useTranslation()`. Two-line change plus catalog entries.

## Perf-optimizer lens: no findings

All ten files are small, leaf-level presentational components. The only computations (guide `split` in SetupGuideSection, scope Set-diff in ScopeMismatchBanner) run on tiny strings at render time; `CompositeHealthDot` already memoizes its score; `ResourcePickerHost` uses `useShallow` and renders null when inactive. No intervals, listeners, subscriptions, queries, or scaling data structures exist in this slice — nothing meets the bar for a real perf finding.
