# vault/catalog [4/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. computeSubtitle hardcodes English UI strings, bypassing i18n, and lives in a "Types" file
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: i18n-inconsistency
- **File**: src/features/vault/sub_catalog/components/design/credentialDesignModalTypes.ts:14
- **Scenario**: Every non-English locale user sees the modal title translated (`t.vault.design_modal.title`) but the subtitle directly under it in raw English ("Describe the service to connect", "Analyzing your request...", "Import from external vault", etc. — ~14 strings).
- **Root cause**: `computeSubtitle` was extracted into the types file as a pure function and never wired to the translation catalog, while every sibling component in this context (`CredentialDesignModal`, `ForagingPanel`, `McpServerCard`, ...) consistently uses `useTranslation`.
- **Impact**: Visible mixed-language header on a primary vault surface for any localized build; also a runtime function living in a `*Types.ts` file, so a "types-only" import assumption is wrong.
- **Fix sketch**: Add the ~14 subtitle strings under `t.vault.design_modal.*`, change `computeSubtitle` to take `t` (or the `design_modal` slice) as a parameter, and call it with `t` from `CredentialDesignModal.tsx:16`. Optionally move the function to a `computeSubtitle.ts` next to the modal, leaving only the interfaces in the types file.

## 2. contextValue rebuilt without useMemo — new identity every orchestrator render forces all CredentialDesignContext consumers to re-render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts:245
- **Scenario**: During the preview phase, `useCredentialDesignOrchestrator` re-renders on every keystroke in the credential-name/field inputs and on every OAuth/healthcheck state tick; `buildContextValue` returns a brand-new object each time, so `CredentialDesignProvider` (CredentialDesignModalBody.tsx:144) publishes a new context value and every `useCredentialDesignContext` consumer under `PreviewPhase` re-renders — including subtrees whose slice (fields, counts, callbacks) did not change.
- **Root cause**: `buildContextValue` is a plain function called inline in the hook body with no memoization; it is also a 26-field 1:1 pass-through (only `flow`→`credentialFlow` and `mergedOAuthValues`→`oauthInitialValues` are renamed), so each new field must be threaded through three files.
- **Impact**: Bounded (form-scale tree, desktop app) but recurring on the hottest interactive path of the design modal — per-keystroke full-subtree re-renders including markdown-rendering setup steps; plus real maintenance drag from the pass-through boilerplate in orchestratorContext.ts.
- **Fix sketch**: Wrap the `design.result ? buildContextValue({...}) : null` expression in `useMemo` keyed on the ~20 actual inputs (the callbacks are already `useCallback`-stable). While there, consider collapsing `buildContextValue` into that inline memoized object literal with the two renames, deleting orchestratorContext.ts entirely.

## 3. BrowserDetail.tsx exports only BrowserStatusBanner — filename/component mismatch
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/vault/sub_catalog/components/autoCred/steps/BrowserDetail.tsx:13
- **Scenario**: A developer searching for `BrowserStatusBanner` (used in AutoCredBrowser.tsx:18) or globbing for a `BrowserDetail` component finds nothing that matches — the file's single export does not correspond to its name.
- **Root cause**: The file was presumably slimmed down to just the banner during an earlier refactor but never renamed.
- **Impact**: Navigation friction only; no runtime cost. Verified: `BrowserStatusBanner` has exactly one importer, and nothing imports a `BrowserDetail` symbol.
- **Fix sketch**: Rename the file to `BrowserStatusBanner.tsx` and update the single import in `AutoCredBrowser.tsx`. Two-line change, zero behavioral risk.

## 4. ForagingPanel handleImport useCallback keyed on unstable `forage` object — memoization never holds
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: dead-memoization
- **File**: src/features/vault/sub_catalog/components/foraging/ForagingPanel.tsx:25
- **Scenario**: `useCredentialForaging()` returns a fresh object each render (standard hook return), so the `[forage, ...]` dependency changes every render and `useCallback` recreates `handleImport` every time — the memoization is pure overhead and misleadingly suggests a stable reference.
- **Root cause**: Depending on the whole hook-return object instead of the stable pieces (`forage.importSelected`).
- **Impact**: Negligible runtime cost (small panel), but it's a footgun: if `ForagingResults` were ever memoized on `onImport`, this would silently defeat it.
- **Fix sketch**: Depend on `forage.importSelected` (if that function is `useCallback`-stable in the hook) instead of `forage`, or drop the `useCallback` entirely since `ForagingResults` is not memoized.
