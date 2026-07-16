# vault/credentials [2/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Infinite dispatch/render loop after universal OAuth completes on catalog-form
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_credentials/manager/useCatalogHandlers.ts:71-76
- **Scenario**: User completes a universal OAuth consent while on the catalog-form view. The effect's dependency array includes the whole `universalOAuth` object, and `useUniversalOAuth` (src/hooks/design/oauth/useUniversalOAuth.ts:73-82) returns a fresh object literal on every render. Once `completedAt` is set and the session ref exists, every render re-runs the effect, which dispatches `SET_OAUTH_VALUES`; the FSM handler (useCredentialViewFSM.ts:218-224) unconditionally returns `{ ...state, oauthValues: action.values }` — a new state object — triggering another render, which re-runs the effect again.
- **Root cause**: Unstable hook return identity used as an effect dependency, combined with an effect that dispatches a state-changing action with no equality bail-out in the reducer.
- **Impact**: Continuous re-render loop (pegged CPU, or a React "Maximum update depth exceeded" crash) for the exact moment the user is finishing an OAuth credential setup — a hot, user-facing flow. The hook even exposes `valuesVersion` ("depend on this for re-renders") precisely to avoid this, and the effect ignores it.
- **Fix sketch**: Change the effect deps to the stable primitives: `[universalOAuth.completedAt, universalOAuth.valuesVersion, catalogFormData, dispatch]` and call `universalOAuth.getValues()` inside (getValues is a stable ref-backed function). Belt-and-braces: wrap `useUniversalOAuth`'s return in `useMemo`, and/or make the `SET_OAUTH_VALUES` handler bail when `action.values` shallow-equals `state.oauthValues`.

## 2. useCredentialListFilters returns ~9 unused members incl. a dead global Escape listener and an unconsumed groupCredentials computation
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/list/useCredentialListFilters.ts:23-111
- **Scenario**: `CredentialList` is the hook's ONLY consumer (verified by grep across src/) and destructures only the id-selection, filter/sort state, `filteredCredentials`, and `getConnectorForType`. Everything else — `selectedTags`/`toggleTag`/`clearFilters`/`hasFilters`, `openDropdown`/`setOpenDropdown`, `allTags`, `grouped`, `showFilterBar`, `selectedId` — is returned to nobody.
- **Root cause**: The hook predates the DataGrid-based list (which owns its own column filters); the tag-filter bar and health/sort dropdown UI it served were removed, but the state, the `window.addEventListener('keydown')` Escape handler for the vanished dropdown (lines 55-61), and the `groupCredentials`/`collectAllTags` memos were left behind.
- **Impact**: A global keydown listener registered per mount for state nothing reads, plus `groupCredentials` (O(n) grouping) and `collectAllTags` recomputed on every credentials/filter change with zero consumers. Also actively misleading: `filterAndSortCredentials` still receives `selectedTags`, so a future caller could believe tag filtering is wired to UI.
- **Fix sketch**: Delete `selectedTags`/`toggleTag`/`clearFilters`/`hasFilters`, `openDropdown` state + the Escape effect, the `allTags`/`grouped`/`showFilterBar` derivations, and trim the return object to what CredentialList uses. If `groupCredentials`/`collectAllTags` in credentialListTypes.ts then have no remaining importers, remove them too (verify: grep shows their only src/ consumers are this hook and the shared credentialTags util).

## 3. CredentialEventConfig fetches the store-wide event list and refetches it after every toggle/config save
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: overfetch
- **File**: src/features/vault/sub_credentials/components/features/CredentialEventConfig.tsx:41-102
- **Scenario**: Opening the events panel for one credential calls `fetchCredentialEvents()` (no credential filter — the component then does `credentialEvents.filter((e) => e.credential_id === credentialId)` client-side), and every toggle (`handleToggleEvent`) and every config field change (`handleUpdateConfig`) awaits another full `fetchCredentialEvents()` round-trip.
- **Root cause**: The vault store keeps one flat global `credentialEvents` array, so the component's only refresh primitive is "refetch everything"; per-interaction refresh was bolted onto that.
- **Impact**: IPC + SQLite cost scales with total events across ALL credentials, not the one being edited, and is paid on every switch flip; the awaited refetch also stretches the `saving` spinner. Bounded today, but grows linearly with vault size and is pure waste — the mutation response already tells the caller what changed.
- **Fix sketch**: Have `createCredentialEvent`/`updateCredentialEvent` update the store's `credentialEvents` entry in place from the mutation result (or accept a `credentialId` filter on `fetchCredentialEvents` and refetch just this credential's rows). Also memoize `myEvents`/`eventTemplates` with `useMemo` while touching the file (minor).

## 4. Duplicate one-shot vaultStatus fetch pattern in two components
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:64-69
- **Scenario**: `CredentialEditForm` and `VaultTrustBadge` (manager/VaultTrustBadge.tsx:25-35) each keep their own `useState<VaultStatus | null>` + mount effect calling `vaultStatus()`, differing only in catch flavor (toast vs silent). Both can be mounted in the same session, issuing duplicate IPC calls for a value that changes essentially never.
- **Root cause**: Copy-per-component instead of a tiny shared hook for a read-only, near-static backend status.
- **Impact**: Duplicate IPC round-trips and two spellings of the same lifecycle to maintain; a third consumer will likely copy it again.
- **Fix sketch**: Extract `useVaultStatus()` in features/vault/shared/hooks (state + mount fetch + silent catch, optionally module-level caching since key_source doesn't change mid-session) and use it in both components.

## 5. AuditLogTable OP_LABELS hardcodes English labels in an otherwise localized component, and is exported without external consumers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/vault/sub_credentials/components/features/AuditLogTable.tsx:14-22
- **Scenario**: The component localizes headers, empty state, and captions via `t.vault.*`, but the operation labels ("Decrypted", "Created", ...), the filter tab "All", the "{n} entries" counter, and "Page x/y" render hardcoded English in all 14 locales. `OP_LABELS` is also `export`ed while grep shows no importer outside this file.
- **Root cause**: The label map was written before the i18n pass and exported speculatively.
- **Impact**: Visible untranslated strings in a localized surface; a needless public export that dead-code tooling can't prune.
- **Fix sketch**: Drop the `export`, move the display strings into `t.vault.audit_log.*` (keep the color/dot config keyed by operation), and localize the "All"/"entries"/"Page" literals alongside.
