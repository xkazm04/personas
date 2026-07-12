> Context: vault/credentials [1/4]
> Total: 8
> Critical: 0  High: 1  Medium: 3  Low: 4

## 1. Chained resource picker keeps stale item list after a parent pick changes
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx:121-142, 111-119
- **Scenario**: A spec `B` has `depends_on: ['A']`. User picks `A=account1`, `B` fetches items scoped to account1. User then changes `A` to `account2`. `toggleItem` deletes `out[B.id]` (the *selection*) but never clears `state[B.id]` (the *fetched items*). The fetch effect guards with `if (state[spec.id]) continue;`, so `B` is never re-fetched — it keeps showing (and lets the user pick) resources belonging to account1's context while the credential is now scoped to account2.
- **Root cause**: Selection state and fetch state are cleared on two different code paths; only selection is invalidated when a dependency changes.
- **Impact**: User can save a scope binding pointing at resources from the wrong parent (incorrect/over-broad credential scope) — a scope-correctness/security concern, and confusing UX.
- **Fix sketch**: In `toggleItem`, when clearing a downstream spec's selection also drop its fetch state: build a `setState` update that `delete`s `s[other.id]` for every `other` whose `depends_on` includes `spec.id`, so the effect re-fetches with the new ctx.

## 2. Duplicate secret keys collide across selection, React keys, and mapping alignment
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_credentials/components/import/importHelpers.ts:163-197; useCredentialImport.ts:97-115; ImportPreview.tsx:108-131
- **Scenario**: A `.env` (or any source) that repeats a key — e.g. `API_KEY=a` twice, common when merging files — yields two `ImportedSecret` rows with the same `key`. `selectedKeys` is a `Set<string>`, so toggling one checkbox toggles both. `ImportPreview` renders `key={secret.key}` → React duplicate-key warning and unstable rows. In `buildResults`, `parseResult.secrets.indexOf(s)` returns the *first* occurrence's index, so the second duplicate is mapped with the wrong `SecretServiceMapping`.
- **Root cause**: `key` is treated as a unique identity everywhere, but the parsers can emit duplicates.
- **Impact**: Wrong service grouping / can't independently select duplicates / React reconciliation glitches. Data-fidelity bug on import.
- **Fix sketch**: Give each parsed secret a stable synthetic id (index-based) and key selection/React lists/mapping lookups on that id instead of `key`; or dedupe keys during parse with a visible warning.

## 3. Rotation period edit updates only the first policy while delete removes all
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_credentials/components/features/RotationActivePolicy.tsx:141-153 vs 90-104
- **Scenario**: `listRotationPolicies(credentialId)` returns an array (delete loops over *all* of them, lines 94-97). The save-period handler updates only `allPolicies[0]`. If a credential ever has more than one rotation policy, changing the interval silently leaves the other policies on their old interval — they keep firing on the stale schedule, while the UI shows the new number.
- **Root cause**: Asymmetric assumption — delete treats policies as a set, edit treats them as a singleton.
- **Impact**: Rotations fire on an interval the user thought they changed; hard-to-diagnose scheduling drift.
- **Fix sketch**: Either iterate `allPolicies` in the update loop (mirror delete), or assert/enforce a single active policy per credential and read that one explicitly.

## 4. Clipboard secret-wipe silently no-ops when clipboard read is denied
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:98-109
- **Scenario**: On copy of a secret, a TTL timer tries to wipe it, but only after `navigator.clipboard.readText()` confirms the value is still ours. If the environment denies/throws on `readText()` (permission revoked, focus lost, webview policy), the `catch` swallows it and the wipe never happens — the secret stays on the OS clipboard indefinitely, defeating the "auto-clear after 30s" guarantee the code advertises.
- **Root cause**: The safety wipe is gated on a read that can fail; failure path does nothing rather than falling back to an unconditional clear.
- **Impact**: Secret persists in clipboard beyond the intended TTL (security/leak).
- **Fix sketch**: On `readText()` failure, fall back to writing empty (best-effort clear) rather than skipping; or track the last-written value in a ref and clear if the read is unavailable.

## 5. Dead exports: `healthFilterLabel` and `sortLabel`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/list/credentialListTypes.ts:15-32
- **Scenario**: Both functions are exported but have zero call sites in `src/` (grep finds only their definitions; the `sortLabel` hit elsewhere is an unrelated symbol in `scripts/perf/render-perf-report.mjs`). They are already listed in `lint-output.json`.
- **Root cause**: Label helpers left behind after the list UI moved to translation keys (`t.vault.credential_list.*`) / DataGrid filter options.
- **Impact**: Maintainability — dead surface area that looks live.
- **Fix sketch**: Delete both functions (and `HealthFilter`/`SortKey` stay — they're still referenced by the filter/sort logic).

## 6. Dead + duplicated interface `ImportFlowState`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/import/importHelpers.ts:99-109
- **Scenario**: `ImportFlowState` is exported but never imported anywhere (grep shows only the definition). It is also a field-for-field duplicate of `CredentialImportState` in `useCredentialImport.ts:15-24`, which is the one actually used.
- **Root cause**: The state shape was inlined into the hook; the original interface was never removed.
- **Impact**: Maintainability — two sources of truth for the same shape invite drift.
- **Fix sketch**: Delete `ImportFlowState`; if a shared type is wanted, have the hook import this one instead of redeclaring.

## 7. Redundant generic-pattern branch in `detectServiceFromKey`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/import/importHelpers.ts:155-159
- **Scenario**: After the `SERVICE_PATTERNS` loop, the `if (/api[_-]?key|token|secret/i.test(key))` branch returns `{ secretKey: key, detectedService: null, connectorName: null, confidence: 'low' }` — byte-for-byte identical to the final fallthrough `return` on line 159. The regex test and its branch have no observable effect.
- **Root cause**: Likely intended to assign `confidence: 'medium'` (the `ImportPreview` UI even has a `medium` amber-dot case, line 96) but currently produces `low`, making the whole block a no-op.
- **Impact**: Confusing dead branch; a latent product bug (the "medium confidence" tier is unreachable).
- **Fix sketch**: Either delete lines 155-158, or (if the medium tier is desired) change that branch to `confidence: 'medium'` so the amber-dot path in `ImportPreview` actually renders.

## 8. Duplicated `FetchState` default literal in ResourcePicker
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx:57, 85, 197
- **Scenario**: The empty `FetchState` object `{ loading: false, items: [], error: null, fetched: false }` (and partial variants) is written inline three times as the fallback for `state[spec.id]`. A field added to `FetchState` must be updated in every copy or the fallback silently diverges.
- **Root cause**: No shared default constant/factory for the per-spec fetch state.
- **Impact**: Maintainability — easy to miss one copy when the shape changes.
- **Fix sketch**: Extract `const EMPTY_FETCH: FetchState = { loading: false, items: [], error: null, fetched: false };` (or a `makeEmptyFetch()` factory) and reference it in all three spots.
