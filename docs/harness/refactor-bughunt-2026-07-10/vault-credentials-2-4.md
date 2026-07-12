> Context: vault/credentials [2/4]
> Total: 7
> Critical: 0  High: 1  Medium: 4  Low: 2

## 1. initialValues effect clobbers in-progress user edits
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:71-74
- **Scenario**: The effect `setValues((prev) => ({ ...prev, ...initialValues }))` runs on every change of the `initialValues` prop identity. `initialValues` merges LAST, so it wins over `prev`. If a parent re-renders and passes a freshly-constructed `initialValues` object (same content, new reference) — or the OAuth flow updates it via `SET_OAUTH_VALUES` — while the user has typed into a field that also exists in `initialValues`, the user's in-progress edit is silently overwritten with the initial value.
- **Root cause**: A merge-on-prop-change effect treats `initialValues` as authoritative on every identity change, conflating "seed once" with "sync always". No guard for fields the user has already `touched`/edited.
- **Impact**: Data loss / confusing UX — typed credential fields revert mid-edit; hard to reproduce because it depends on parent render cadence and object identity.
- **Fix sketch**: Only seed from `initialValues` for keys the user hasn't touched (`if (!touched[key]) next[key] = initialValues[key]`), or gate the merge behind a `useRef` first-run/`credentialId`-change check so re-supplying the same values is a no-op.

## 2. Non-atomic read-modify-write on event config loses concurrent updates
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/vault/sub_credentials/components/features/CredentialEventConfig.tsx:87-102
- **Scenario**: `handleUpdateConfig` reads `existing.config` from the closure, spreads `{...currentConfig, ...updates}`, and writes it back. Unlike `handleToggleEvent`, it has NO in-flight guard. If the user changes two config controls on the same event quickly (e.g. cron field then threshold field), both handlers capture the same pre-update `existing.config` snapshot; the second write overwrites the first field's change. `setSaving` is a single shared string, so the two operations also race the spinner/`null` reset.
- **Root cause**: RMW against a render-time snapshot with no per-event serialization (the toggle path has `toggleInFlightRef`, this path was never given one).
- **Impact**: Lost config edits — user sets two options, one silently reverts on refetch.
- **Fix sketch**: Reuse a per-`eventId` in-flight ref (as `handleToggleEvent` does), and/or funnel config writes through a queue that re-reads the latest event before merging.

## 3. Split-paren i18n contract breaks in the Indonesian locale
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_credentials/components/card/banners/ReauthBanner.tsx:104-106
- **Scenario**: The JSX emits an unbalanced opening paren — `({entry.serviceType}` — and relies on every translation of `access_revoked`/`cli_expired` to START with the closing `)`. Nearly all locales honor this (`") -- access was revoked…"`), but `id/vault.json` (and `id.json`) has `"access_revoked": "Akses dicabut"` with no leading `)`. In Indonesian the OAuth banner renders `(gmail Akses dicabut` — a dangling open paren and lost sentence, on a security-sensitive re-auth prompt.
- **Root cause**: Punctuation split across code and translation string; the contract is implicit and unenforced, so one drifted locale silently violates it.
- **Impact**: UX / trust — malformed message on a re-authorization banner in one shipped locale.
- **Fix sketch**: Move the parentheses fully into code (`({entry.serviceType}) {t...}`) so the translation carries only prose, and fix the `id` string; add a lint/test asserting the two keys don't need a leading paren.

## 4. Audit pagination not clamped when the log shrinks
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/vault/sub_credentials/components/features/AuditLogTable.tsx:28-36
- **Scenario**: `auditPage` is only reset to 0 on filter change. If the `auditLog` prop shrinks while the user is on a high page (e.g. entries pruned/re-fetched, or switching to a credential with fewer entries reusing the mounted component), `auditPage` can exceed the new `totalPages-1`; `filtered.slice(auditPage*20, …)` returns `[]` and the table shows an empty body with no "prev" affordance obvious to the user.
- **Root cause**: Page index is independent state with no clamp against the derived `totalPages`.
- **Impact**: UX — blank audit table until the user notices and pages back.
- **Fix sketch**: Add `useEffect(() => setAuditPage(p => Math.min(p, totalPages-1)), [totalPages])`, or clamp at render.

## 5. useCredentialListFilters exports a large dead surface (incl. wasted grouping pass)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/list/useCredentialListFilters.ts:17-113
- **Scenario**: The hook is imported by exactly one consumer (verified via grep: only `CredentialList.tsx`). `CredentialList` destructures ~14 of the returned keys, but never uses: `selectedTags`, `toggleTag`, `clearFilters`, `allTags`, `hasFilters`, `grouped`, `showFilterBar`, `openDropdown`, `setOpenDropdown`. That means the `groupCredentials(...)` `useMemo` (a full second pass over the filtered list), `collectAllTags`, the `selectedTags` state, and the Escape-key `useEffect` for `openDropdown` all run every render for nothing.
- **Root cause**: Hook retained a grouped/tag-filter/dropdown feature set that the current DataGrid-based `CredentialList` no longer consumes.
- **Impact**: Maintainability + minor perf — dead state and an unnecessary O(n) grouping/sort recompute on every filter/sort change.
- **Fix sketch**: Delete the unused state (`selectedTags`, `openDropdown`, their setters), the Escape listener, and the `grouped`/`allTags`/`hasFilters`/`showFilterBar`/`toggleTag`/`clearFilters` outputs (and their imports from `credentialListTypes`) unless another surface is planned; keep filter/sort/selection.

## 6. Redundant vaultStatus fetch — two components each poll on mount
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_credentials/manager/VaultTrustBadge.tsx:28-34 ; src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:67-69
- **Scenario**: `VaultTrustBadge` (rendered on the list view) and `CredentialEditForm` each independently call `vaultStatus()` on mount and hold their own `VaultStatus` state. Both live under the same `CredentialManager` subtree. The value (AES/keychain/local status) is process-stable, so two IPC round-trips fetch the same thing with divergent error handling (`silentCatch` vs `toastCatch`).
- **Root cause**: No shared cache/selector for vault status; each consumer re-fetches.
- **Impact**: Maintainability — duplicated fetch + inconsistent failure UX; grows with every new consumer.
- **Fix sketch**: Hoist vault status into `useVaultStore` (or a tiny `useVaultStatus` hook with a module-level cache) and have both components read it, so it's fetched once and errors are handled uniformly.

## 7. `saving` indicator flicker/clobber across events in CredentialEventConfig
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/features/vault/sub_credentials/components/features/CredentialEventConfig.tsx:30-101
- **Scenario**: A single `saving: string | null` state models "which template is saving", but it's set/cleared by three async paths (`handleToggleEvent`, `handleUpdateConfig`) with `finally { setSaving(null) }`. When operations on two different templates overlap, whichever `finally` runs first clears the spinner for the still-in-flight other one (`isSaving={saving === et.id}` goes false early). Combined with finding #2, the shared scalar makes per-card busy state unreliable.
- **Root cause**: One scalar used to represent independent per-template busy states.
- **Impact**: UX — spinners disappear while a save is still running; misleads the user into re-clicking.
- **Fix sketch**: Track busy state as a `Set<string>`/record of in-flight template ids (as already done with `toggleInFlightRef`), and derive `isSaving` from membership rather than equality with a single id.
