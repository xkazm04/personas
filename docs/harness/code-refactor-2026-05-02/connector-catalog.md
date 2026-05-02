# Code Refactor Scan — Connector Catalog

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~32

## Summary

The Connector Catalog area lives under `src/features/vault/sub_catalog/components/` and is composed of seven well-separated subfolders (picker, design, autoCred, foraging, desktop, schemas, negotiator, forms). The picker layer (the core "browsable catalog" — `CredentialPicker`, `ConnectorCard`, `usePickerFilters`) is in good shape: small, single-purpose modules with sensible composition. The two dominant refactor patterns are (1) **a substantial dead-code island around the "Universal AutoCred" feature** — five files (~600 LOC) including `UniversalAutoCredPanel`, plus a `showUniversal`/`setShowUniversal` switch in `useCredentialDesignModal` that is plumbed but never read by any consumer — and (2) **drift in URL-extraction regexes** (four near-duplicate `https?://[^\s)]+` patterns scattered across catalog/autoCred files). A third smaller theme is unused-but-returned hooks state (`dialogRef`, `handleFocusTrap`, `handleAutoSetup` mode-checking) hanging on after `BaseModal` took over focus management.

## 1. Universal AutoCred subgraph is dead code (~600 LOC, 5 files)

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/vault/sub_catalog/components/autoCred/steps/UniversalAutoCredPanel.tsx`, `UniversalAutoCredInputPhase.tsx`, `UniversalAutoCredRunningPhase.tsx`, `UniversalAutoCredReview.tsx`, `universalAutoCredHelpers.ts` (and `ReviewTable.tsx#UniversalFieldRow`)
- **Scenario**: `UniversalAutoCredPanel` is exported from the autoCred steps barrel and orchestrates a full free-text-URL credential discovery flow. The state that would gate it (`showUniversal` / `setShowUniversal` in `useCredentialDesignModal.ts:30,83,124,196-197`) is set internally and returned from the hook, but **no consumer reads it** — neither `CredentialDesignModal.tsx` nor `CredentialDesignModalBody.tsx` plumb `showUniversal` through, and there is no other render site in the codebase.
- **Root cause**: A "build the panel + the toggle, wire the render last" plan that stalled. The toggle was wired through the hook but the modal body branch that would render `<UniversalAutoCredPanel>` was never added.
- **Impact**: Future readers chasing the "discover any service from a URL" capability waste an hour proving it doesn't ship. ~600 LOC ships in the bundle. The shared `tauriPlaywrightAdapter`/`tauriGuidedAdapter` and `useAutoCredSession` are reachable via `AutoCredPanel`, so deletion is safe — only this subtree is orphan.
- **Fix sketch**:
  - Either delete the 5 universal files + drop `UniversalFieldRow` from `ReviewTable.tsx` + remove `showUniversal`/`setShowUniversal` from `useCredentialDesignModal.ts`, plus remove the `UniversalAutoCredPanel` and `UniversalAutoCredReview` re-exports from `autoCred/steps/index.ts`.
  - Or, if the feature is intentionally pending, gate behind a single `import.meta.env.DEV`-only render branch in `CredentialDesignModalBody` so it's at least exercised — leaving it dead forever is the worst outcome.

## 2. `SetupGuideModal` is unreferenced

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/vault/sub_catalog/components/picker/SetupGuideModal.tsx` (193 lines)
- **Scenario**: `SetupGuideModal` is a self-contained modal that fetches CLI capture availability and renders a setup-guide flow with CLI capture CTA. A project-wide grep for `SetupGuideModal` finds **only** docs files (`docs/harness/*`), `lint-output.json`, the file's own self-references, and a comment in `src/lib/types/types.ts:176` ("Markdown body shown in the SetupGuideModal"). No render site, no tests, no story.
- **Root cause**: The setup-guide UX was reimplemented inline inside `CredentialTemplateForm.tsx` (via `SetupGuideSection` from `sub_credentials`) but the standalone modal was never deleted.
- **Impact**: 193 LOC + 4 lucide icons + `cliCaptureRun`/`listCliCapturableServices` API imports reachable only here. The comment in `types.ts:176` actively misleads readers about where setup_guide is rendered. Several past audit reports (`bug-hunt-2026-04-27/connector-catalog.md`, `ambiguity-2026-04-27/connector-catalog.md`) reference bugs in this dead file — every audit pays a recurring cost.
- **Fix sketch**:
  - Delete `SetupGuideModal.tsx`.
  - Update the comment in `src/lib/types/types.ts:176` to point at `SetupGuideSection` (the live consumer).

## 3. `dialogRef` + `handleFocusTrap` returned by modal hook but never plumbed

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/vault/sub_catalog/components/design/useCredentialDesignModal.ts:35,49-71,99,175-176`
- **Scenario**: The hook owns a `dialogRef`, a focus-trap `handleFocusTrap` callback, and `returnFocusRef` restoration. They're returned from the hook, but neither `CredentialDesignModal.tsx` nor `CredentialDesignModalBody.tsx` consumes `dialogRef` or `handleFocusTrap` — the modal renders inside `<BaseModal>` which does its own focus trapping.
- **Root cause**: This hook predates the migration to `BaseModal`. The focus management that used to live here was never deleted after `BaseModal` took over.
- **Impact**: ~30 LOC of subtly-correct focus-trap code that future readers may "fix" or duplicate. The `requestAnimationFrame` focus call (line 96-101) silently fails because nothing renders the ref.
- **Fix sketch**:
  - Remove `dialogRef`, `returnFocusRef`, `handleFocusTrap`, the focus-on-mount effect, the focus-restore effect.
  - Trim the hook return type accordingly.

## 4. Four near-duplicate URL-extraction regexes in the same area

- **Severity**: medium
- **Category**: duplication
- **File**: `design/CredentialDesignHelpers.ts:22` (`extractFirstUrl`), `autoCred/helpers/types.ts:184` (inline in `buildConnectorContext`), `autoCred/helpers/autoCredHelpers.ts:142` (`URL_REGEX`), `autoCred/display/AutoCredCards.tsx:18` (inline)
- **Scenario**: Four implementations of essentially the same task (pull the first http(s) URL out of free text). Three patterns are `/https?:\/\/[^\s)]+/`, the fourth (`URL_REGEX`) is `/https?:\/\/[^\s)>\]"'`*_]+/g` — drift has already started: the autoCred-display variant strips markdown punctuation that the design-helper variant does not. `extractFirstUrl` exists, is exported, but is bypassed inline by `buildConnectorContext`.
- **Root cause**: Each module solved the same problem locally instead of importing.
- **Impact**: Bug fixes (e.g. "URLs with closing parentheses are getting truncated") have to be applied 4 times. Inconsistent behaviour between consent-screen URL extraction and log-card URL extraction.
- **Fix sketch**:
  - Move the strict (markdown-aware) `URL_REGEX` to a shared util (e.g. `lib/utils/text/urls.ts`) with `extractFirstUrl(text)` and `splitByUrls(text)`.
  - Replace the three inline regexes (`buildConnectorContext`, `AutoCredCards`, `CredentialDesignHelpers`) with imports.

## 5. `AutoCredPanel` and `UniversalAutoCredPanel` duplicate the mode-detection + cleanup boilerplate

- **Severity**: medium
- **Category**: duplication
- **File**: `autoCred/steps/AutoCredPanel.tsx:30-78`, `autoCred/steps/UniversalAutoCredPanel.tsx:23-50`
- **Scenario**: Both panels independently:
  1. Run `checkPlaywrightAvailable()` in a `useEffect` to derive `mode`.
  2. Pick `tauriGuidedAdapter | tauriPlaywrightAdapter` from `mode`.
  3. Mirror `session.phase` and `session.cancelBrowser` into refs and run a cleanup-on-unmount that aborts a running browser.
  This is ~30 lines of exact-twin code each side.
- **Root cause**: Universal mode was forked from AutoCred and never refactored to share the "session lifecycle owner" portion.
- **Impact**: Bugs in either copy stay one-sided. (Note: this finding is moot if Finding #1 is taken — deleting Universal makes this go away. Listed separately because if Universal stays, this should be fixed.)
- **Fix sketch**: Extract a `useAutoCredAdapter()` hook that returns `{ mode, modeChecked, adapter }` plus a `useCancelOnUnmount(session)` companion hook. Both panels collapse to ~5 lines of setup.

## 6. `getProviderLabel` + redundant case in `deriveCredentialFlow`

- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts:170-179`
- **Scenario**: `getProviderLabel(flow)` returns `flow.providerLabel` for both OAuth variants and `''` for `api_key`. A grep for `getProviderLabel` finds only the function definition — no consumers.
- **Root cause**: Helper added during the OAuth-discriminated-union refactor; consumers ended up reading `flow.providerLabel` directly.
- **Impact**: Tiny — but it's part of a pattern: this same file has 6 small derived-value helpers (`getProviderLabel`, `isOAuthFlow`, `getOAuthConsentHint`, `getSaveDisabledReason`, `getHiddenFieldKeys`, `showsHealthcheck`, `showsNegotiator`). Worth a one-pass audit to confirm each has a real consumer; deletion of unused helpers reduces the surface area for the next OAuth-flow contributor to learn.
- **Fix sketch**:
  - Delete `getProviderLabel`.
  - Spend 10 minutes greping each of the others. (`isOAuthFlow` is also worth checking — at a glance the call sites use `flow.kind === 'google_oauth' || flow.kind === 'provider_oauth'` directly in some places.)

## 7. Three `checkPlaywrightAvailable` `.then().catch()` ladders with identical fallback

- **Severity**: low
- **Category**: duplication
- **File**: `autoCred/steps/AutoCredPanel.tsx:34-45`, `autoCred/steps/UniversalAutoCredPanel.tsx:37-41`, `autoCred/steps/CatalogAutoSetup.tsx:68-72`
- **Scenario**: Each call follows the exact same pattern: `checkPlaywrightAvailable().then(set 'playwright' if available else 'guided').catch(set 'guided')`. The default `mode` state initializer is also `'playwright'` in all three.
- **Root cause**: Pattern was copy-pasted across the three entry points instead of factored.
- **Impact**: Three places to update if the playwright/guided decision ever needs to consider another input (e.g. user preference, network reachability).
- **Fix sketch**: A `useAutoCredMode()` hook returning `{ mode, modeChecked }` removes 30+ lines and unifies the fallback semantics.

## 8. `CredentialTypePicker.onSelectDesktop` is required but the desktop tile is DEV-only

- **Severity**: low
- **Category**: naming / structure
- **File**: `src/features/vault/sub_catalog/components/forms/CredentialTypePicker.tsx:5-14,45-52`
- **Scenario**: The `CredentialTypePickerProps` interface declares `onSelectDesktop: () => void` as required. But the `desktop` tile is only included in the rendered grid when `import.meta.env.DEV` is true and the platform isn't mobile (line 95: `TYPES.filter((t) => !IS_MOBILE || t.id !== 'desktop')`). In a production build, callers must still supply a handler that will never be invoked.
- **Root cause**: Required prop predates the DEV-gating of the desktop tile.
- **Impact**: Mild — minor noise in the props interface and call sites in `CredentialAddViews.tsx`. Adds confusion about which paths are reachable.
- **Fix sketch**:
  - Make `onSelectDesktop` optional and short-circuit on the click handler if absent.
  - Or move the `import.meta.env.DEV` check to the consumer (`CredentialAddViews.tsx`) so the picker accepts only the handlers actually wired.

## 9. `CredentialSchemaForm.tsx` re-exports types/configs "for backwards compatibility"

- **Severity**: low
- **Category**: cleanup
- **File**: `src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx:11-13`
- **Scenario**:
  ```ts
  // Re-export types and configs for backwards compatibility
  export type { SchemaSubType, ExtraFieldDef, SchemaFormConfig } from './schemaFormTypes';
  export { MCP_SCHEMA, CUSTOM_SCHEMA, DATABASE_SCHEMA } from './schemaConfigs';
  ```
  The only external importer (`sub_credentials/manager/CredentialAddViews.tsx:3`) already imports `MCP_SCHEMA`, `CUSTOM_SCHEMA`, `DATABASE_SCHEMA` directly through `CredentialSchemaForm` — but it could just as easily import from `./schemaConfigs`. There are no other importers of these re-exports.
- **Root cause**: The schemas/configs were extracted out of `CredentialSchemaForm` into separate files and the re-exports were left behind to avoid breaking consumers that no longer exist.
- **Impact**: Tiny — but the comment implies external consumers that aren't there, misleading future readers.
- **Fix sketch**:
  - Delete the re-export block.
  - Update the one importer in `CredentialAddViews.tsx` to import from `'./schemas/schemaConfigs'`.

> Total: 9 findings (2 high, 4 medium, 3 low)
