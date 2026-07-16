# vault (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 0 medium / 2 low)
> Context group: Credentials & Connectors | Files read: 3 | Missing: 0

## 1. VaultConnectorPicker empty state is unreachable dead code (sentinel card makes `items.length === 0` impossible)
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/components/VaultConnectorPicker.tsx:115-174
- **Scenario**: A user with zero eligible credentials for the requested category opens the picker. The `items` memo unconditionally pushes the `ADD_FROM_VAULT_SENTINEL` card (line 115-119), so `items.length` is always ≥ 1 and the entire `if (items.length === 0)` branch (lines 123-174) — the designed empty state with "No {category} connector in your vault yet", the "Add {category} connector" CTA, and the `onAddFromCatalog` "Open Catalog" button — can never render.
- **Root cause**: The sentinel push was added inside the same memo that builds credential cards, after the empty-state branch was written against a credentials-only list; nobody re-checked the guard.
- **Impact**: ~50 lines of dead JSX (including a fully duplicated `QuickAddCredentialModal` block and the `onAddFromCatalog` prop path, which is now effectively unused from this component). Users with an empty vault see a lone "Add a different credential" tile instead of the explanatory empty state, and `onAddFromCatalog` callers get no catalog deep-link. The `data-testid="vault-connector-picker-empty"` tests, if any exist, can only be passing against a stale build.
- **Fix sketch**: Decide which UX wins. Either (a) gate the sentinel push on `eligible.length > 0` so the dedicated empty state renders again, or (b) delete the dead branch, its duplicated modal block, and (after verifying no other reachable use) the `onAddFromCatalog` prop. In either case keep exactly one `<QuickAddCredentialModal>` instance rendered at the component root instead of two verbatim copies.

## 2. ADD_FROM_VAULT_SENTINEL duplicated across two files despite a "centralised here" comment
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/components/CredentialPickerCards.tsx:31 (and VaultConnectorPicker.tsx:36)
- **Scenario**: Someone renames or namespaces the sentinel in one file (both doc comments claim ownership: CredentialPickerCards says "Centralised here", VaultConnectorPicker says it "emits" it) and the other copy silently stops matching — the "+" tile renders as a normal credential card and the QuickAdd modal never opens.
- **Root cause**: The string literal `'__add_from_vault__'` is declared as a private module constant in both the emitter and the renderer instead of being exported from one place.
- **Impact**: Bounded but real drift hazard on a protocol value shared across a component boundary; the contradictory comments already show the ownership story is confused.
- **Fix sketch**: Export `ADD_FROM_VAULT_SENTINEL` from CredentialPickerCards.tsx (the renderer that gives it visual meaning) and import it in VaultConnectorPicker.tsx; delete the duplicate declaration and fix the stale comment.

## 3. Suggested-flag and connector-meta lookups recomputed per comparison / per render instead of once per item
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: cpu
- **File**: src/features/vault/components/VaultConnectorPicker.tsx:101-108 (and CredentialPickerCards.tsx:120)
- **Scenario**: With N credentials and K ambient suggestions, the sort comparator calls `isSuggested` twice per comparison — each doing a regex normalize plus a K-way substring scan — for O(N log N · K) regex work, then `isSuggested` runs again in the map. In CredentialPickerCards, `resolveConnectorMeta` does a linear `BUILTIN_CONNECTORS.find` per item on every render (including every selection toggle).
- **Root cause**: Derived per-item values (suggested flag, connector meta) are computed inline at use sites rather than precomputed once.
- **Impact**: Negligible today (vaults hold a handful of credentials, catalog is dozens of entries); flagged as Low only because the fix is a strict simplification, not for measurable wins.
- **Fix sketch**: In the `items` memo, map credentials to `{ cred, suggested: isSuggested(...) }` once, then sort on the precomputed flag. If touched anyway, build a `Map` keyed by connector name for `resolveConnectorMeta` at module scope. Skip entirely if not editing these lines for finding #1.
