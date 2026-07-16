# vault/credentials [1/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 2 medium / 4 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Gateway member toggle/remove refetches the entire credential list
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetching
- **File**: src/features/vault/sub_credentials/components/gateway/GatewayMembersModal.tsx:64
- **Scenario**: Every add, enable/disable toggle, or removal of a gateway member calls `refresh()`, which re-runs `Promise.all([listMcpGatewayMembers(...), listCredentials()])`. Toggling three members fires three full `listCredentials()` round-trips across Tauri IPC + SQLite even though the credential catalog cannot have changed.
- **Root cause**: A single `refresh` callback is reused for both initial load and post-mutation refresh; only the member list can actually change after a mutation, but the "all credentials" fetch is bundled into the same function.
- **Impact**: Redundant IPC + full-table reads on every interaction in the modal; also causes the whole modal to flip into the `isLoading` spinner state (list flashes) on a simple toggle because `refresh()` sets `setIsLoading(true)`.
- **Fix sketch**: Split into `loadAll()` (mount only) and `refreshMembers()` (mutations) that only calls `listMcpGatewayMembers`. Have `refreshMembers` skip `setIsLoading(true)` (or use a lighter `isMutating` flag) so the member list doesn't unmount/remount on each toggle. For `setMcpGatewayMemberEnabled`, an optimistic local `setMembers` update would remove the round-trip entirely.

## 2. CredentialIntelligence eagerly loads a 500-row audit log for a tab the user may never open
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetching
- **File**: src/features/vault/sub_credentials/components/features/CredentialIntelligence.tsx:43
- **Scenario**: Opening the intelligence panel for any credential fires `getCredentialAuditLog(credentialId, 500)` in parallel with stats/dependents, and the whole panel (including the default Overview tab) blocks on the slowest of the three. The 500-row payload is only rendered when the user clicks the Audit sub-tab.
- **Root cause**: One `Promise.all` on mount fetches data for all three sub-tabs; the audit rows are used up-front only as a count in the tab label.
- **Impact**: 500 rows serialized across IPC per credential open, and Overview render latency is gated on the audit query even when the user only wants the stat cards. Multiplied across credentials this is the hottest query in the panel.
- **Fix sketch**: Fetch stats + dependents on mount; lazy-load the audit log on first switch to the `audit` tab (cache in state afterwards). If the tab label needs a count without the rows, add/use a cheap count query, or drop the count until loaded ("Audit log"). Keep `loading` scoped per-tab so Overview renders as soon as stats resolve.

## 3. `ImportFlowState` duplicates `CredentialImportState` and is unused
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/import/importHelpers.ts:100
- **Scenario**: `ImportFlowState` (phase/sourceId/rawInput/parseResult/mappings/selectedKeys/syncConfig/error) is exported from importHelpers.ts but never imported anywhere; `useCredentialImport.ts:15` re-declares the exact same shape as `CredentialImportState`.
- **Root cause**: The hook was written with its own state interface instead of reusing the one already defined next to the parsers, leaving the original stranded.
- **Impact**: Two identical interfaces to keep in sync; the dead one misleads readers into thinking it is the canonical flow-state type. Verified by grep — only the definition site references `ImportFlowState` (cross-context callers checked, none found).
- **Fix sketch**: Delete `ImportFlowState` from importHelpers.ts, or (better) have `CredentialImportState` in useCredentialImport.ts extend/alias it and delete the duplicate field list. One line of `export type CredentialImportState = ImportFlowState;` would do.

## 4. `healthFilterLabel` and `sortLabel` are dead exports with untranslated strings
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/list/credentialListTypes.ts:15
- **Scenario**: Grep across `src/` finds no callers of `healthFilterLabel` or `sortLabel` — only their definitions. The list UI now sources filter/sort labels from the i18n catalog via `useCredentialColumns`.
- **Root cause**: Leftovers from a previous filter/sort dropdown implementation that was replaced by DataGrid column filters.
- **Impact**: ~20 lines of dead code carrying hardcoded English strings ('All health', 'Last used', …) that would silently bypass i18n if anyone resurrected them. (Verification needed only for dynamic use; none is plausible for plain functions.)
- **Fix sketch**: Delete both functions from credentialListTypes.ts. The `HealthFilter`/`SortKey` types they switch over are still used and stay.

## 5. `detectServiceFromKey` generic-pattern branch is a no-op
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/import/importHelpers.ts:156
- **Scenario**: After the SERVICE_PATTERNS loop, the `if (/api[_-]?key|token|secret/i.test(key))` branch returns `{ detectedService: null, connectorName: null, confidence: 'low' }` — byte-for-byte identical to the fallback return on the next line.
- **Root cause**: The branch was presumably meant to return a different confidence (e.g. `'medium'` for "looks like a secret but unknown service") but was flattened to match the fallback, leaving a conditional that changes nothing.
- **Impact**: Misleading structure — readers (and the regex evaluation on every imported key) pay for a distinction that doesn't exist. The `'medium'` confidence level rendered in ImportPreview.tsx:96 is consequently unreachable from this detector.
- **Fix sketch**: Either delete the branch entirely, or make it meaningful by returning `confidence: 'medium'` so ImportPreview's amber medium-confidence dot can actually appear. Pick one deliberately; don't keep the dead fork.

## 6. `buildResults` uses `indexOf` inside `map` — quadratic and fragile on duplicate keys
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: quadratic-scan
- **File**: src/features/vault/sub_credentials/components/import/useCredentialImport.ts:101
- **Scenario**: On import commit, `selected.map((s) => parseResult.secrets.indexOf(s))` scans the full secrets array once per selected secret — O(n²) for a large .env or Doppler dump (hundreds to low thousands of keys), plus it relies on parallel-array positioning between `secrets` and `mappings`.
- **Root cause**: `mappings` is stored as an index-parallel array to `parseResult.secrets` instead of being keyed, forcing positional re-derivation at use time.
- **Impact**: Bounded (runs once per import, n is typically small) but a needless n² on the largest realistic inputs, and the parallel-array coupling is a latent correctness hazard if either array is ever filtered independently.
- **Fix sketch**: Build a `Map<string, SecretServiceMapping>` keyed by `secretKey` once (in `parse()` or memoized) and look mappings up by `s.key` in `buildResults`. This removes both the quadratic scan and the positional coupling; `groupByService` can take the map too.
