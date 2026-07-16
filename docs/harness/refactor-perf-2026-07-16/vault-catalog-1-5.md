# vault/catalog [1/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Auth-detection fetch + mapping block duplicated verbatim in orchestrator and NegotiatorPanel
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts:51
- **Scenario**: Both `useCredentialDesignOrchestrator.ts:51-70` and `NegotiatorPanel.tsx:32-49` call `detectAuthenticatedServices()`, filter on `d.authenticated`, and map the same 5 fields (`serviceType`/`method`/`authenticated`/`identity`/`confidence`) into `AuthDetectionInfo[]` — including identical cancelled-flag and silentCatch scaffolding. The NegotiatorPanel copy is the fallback path when the orchestrator prefetch didn't run.
- **Root cause**: The prefetch optimization (orchestrator) was added by copying the panel's fetch block instead of extracting the shared fetch-and-map into a helper.
- **Impact**: Any change to the `AuthDetectionInfo` shape, the `authenticated` filter, or error handling must be made twice; the two copies have already drifted slightly (orchestrator degrades to `[]` on error, panel leaves state as-is), which makes behavior differ depending on whether prefetch fired.
- **Fix sketch**: Extract `async function fetchAuthDetections(): Promise<AuthDetectionInfo[]>` (fetch + filter + map, throwing on failure) next to `useCredentialNegotiator`'s `AuthDetectionInfo` type. Both call sites keep their own cancelled-guard/catch policy but share the mapping. ~15 LOC deleted.

## 2. Hardcoded English strings bypass i18n in CodebaseProjectPicker
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx:129
- **Scenario**: A non-English locale user opening the Codebase connector form sees mixed languages: "Retry" (line 129), the instruction paragraphs "Select projects to include in cross-project analysis." / "Select a project to connect as a codebase source for your agents." (lines 195-197), the save button "Connect N Projects" with inline English pluralization (line 214), and placeholders "My Codebases"/"My Codebase" (line 188) — while every sibling string in the same component goes through `t`/`ps`.
- **Root cause**: Strings were added after the i18n pass (the file even uses `DebtText` for one string, showing the debt was known) and never routed through the translation bundle.
- **Impact**: Locale drift in a user-facing credential flow; the inline `${selectedIds.size !== 1 ? 's' : ''}` pluralization cannot be translated at all without restructuring.
- **Fix sketch**: Move the five strings into `t.vault.picker_section` (the file already destructures `ps`), using `tx` with a count placeholder plus one/other variants for the connect button, matching the `imported_to_vault_one/_other` pattern used elsewhere in this context.

## 3. Orchestrator context value rebuilt every render with broken memo deps — all context consumers re-render on every keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts:245
- **Scenario**: Once a design result exists (preview phase), every orchestrator re-render — each `credentialName` keystroke, each health-state tick, each negotiator value change — constructs a brand-new `contextValue` object (line 245, no `useMemo`), so every `CredentialDesignContext` consumer re-renders even when nothing it reads changed.
- **Root cause**: `buildContextValue` is called inline in the hook body; additionally `mergedOAuthValues` (line 96) memoizes on the `oauth`/`universalOAuth` hook-return objects, which are typically fresh objects per render, making that memo recompute every render and feed a fresh object into `useFieldValidation` and the context value regardless.
- **Impact**: The credential design modal (field grid, OAuth panels, negotiator, healthcheck section) re-renders wholesale per keystroke. Bounded by form size so not High, but it defeats the split into memo-friendly sub-hooks (`orchestratorDerived`, `orchestratorContext`) that clearly aimed at render hygiene.
- **Fix sketch**: Memoize `mergedOAuthValues` on `oauth.getValues()`/`universalOAuth.getValues()` outputs (or on the stable value snapshots the hooks expose) instead of the hook objects, and wrap the `buildContextValue` call in `useMemo` keyed on its actual inputs. Handlers are already `useCallback`-stable so the memo will hold between unrelated state ticks.

## 4. AutoCredPanel init effect depends on the `designResult` object, defeating its own fieldsHash guard
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_catalog/components/autoCred/steps/AutoCredPanel.tsx:98
- **Scenario**: The init effect's dep array is `[designResult, designResult.connector.name, fieldsHash]`. The comment (lines 91-95) documents a prior bug where re-running init bounced the phase back to `consent` mid-session, and says init should re-run "only when the connector / field shape changes" — but including the `designResult` object itself makes the other two deps redundant: any parent that passes a freshly-derived object (e.g. after a spread/merge in the design flow) re-triggers init and silently resets a running browser session back to the consent screen.
- **Root cause**: The object dep was left in when `fieldsHash` and `connector.name` were added as the intended identity keys.
- **Impact**: Latent regression of the exact bug the guard was built for — currently masked because `designResult` comes from stable `useState` in the orchestrator, but a refactor that derives the prop breaks the auto-cred session reset behavior with no type or test signal.
- **Fix sketch**: Drop `designResult` from the dep array, keep `[designResult.connector.name, fieldsHash]`, and read the current result inside the effect via a ref (the existing `initRef` pattern already shows how). Add an eslint-disable with the explanation the comment already contains.

## 5. `useElapsed` reimplements the shared `useElapsedTimer` hook
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers.ts:80
- **Scenario**: `useElapsed` (interval + `Date.now()` state + cleanup) duplicates `src/hooks/utility/timing/useElapsedTimer.ts`, which the app already exports from `@/hooks` and uses in at least four features (terminal header, execution player, runner state, use-case execution). Two more private clones exist elsewhere (`useElapsedTime` in AiHealingStreamOverlay, `useElapsedSeconds` in CompilationStepper), showing this pattern keeps getting re-derived.
- **Root cause**: The auto-cred helper needed a start-timestamp-based variant with mm:ss formatting and was written from scratch instead of composing the shared timer.
- **Impact**: Four near-identical interval hooks to maintain; interval-leak or drift fixes must be applied in each copy.
- **Fix sketch**: Rebase `useElapsed` on `useElapsedTimer(Boolean(startTs))` plus a small pure `formatElapsed(ms)` function, or extend the shared hook with an optional `startTs` mode. Keep the mm:ss formatter exported for reuse by the other two clones in a follow-up (they are outside this context — verify before touching).
