# Test Mastery — Persona Editor & CRUD
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. `is_valid_asset_id` path-traversal guard is the only thing standing between a crafted IPC call and arbitrary file delete/read — and it has zero tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/core/persona_icons.rs:58-60 (guard), :164-208 (`list_persona_icons` / `delete_persona_icon`)
- **Current test state**: none — `persona_icons.rs` has no `#[cfg(test)]` module at all
- **Scenario**: `delete_persona_icon(asset_id)` joins `asset_id` into a filesystem path and `fs::remove_file`s it. The *only* defense against `asset_id = "../../config/db"` (or any traversal/absolute path) is `is_valid_asset_id`, which requires exactly 64 ASCII hex chars. A regression that loosens this check (e.g. someone "relaxes" it to allow uppercase, or drops the length check, or short-circuits on empty) silently turns an icon-delete command into an arbitrary-file-delete primitive. Today nothing would catch that.
- **Root cause**: The security boundary is a tiny pure predicate, but it was never pinned with tests; the comment ("closes off `../` traversal") asserts a property no test enforces.
- **Impact**: Local-privilege file deletion / library enumeration outside the icons dir; data loss or corruption of the app DB / credentials store from a single malformed IPC payload.
- **Fix sketch**: Add a `#[cfg(test)]` module asserting `is_valid_asset_id` is true *only* for a 64-char lowercase-hex string and false for: `"../foo"`, `"..\\foo"`, absolute paths, `""`, 63/65-char strings, uppercase hex, names with `/` or `.`, and a 64-char string containing a non-hex char. **llm-generatable**: this is a pure predicate — generate a table-driven batch. Invariant to assert: *every accepted id contains no path separators and round-trips to exactly one file inside `persona-icons/`*. Pair it with a `delete_persona_icon` test asserting `AppError::Validation` (not a filesystem call) for any invalid id.

## 2. `delete_persona_inner` system-persona protection + execution-drain accounting are untested — a regression could delete the Director or under-report force-cancels
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/core/personas.rs:491-623 (`delete_persona_inner`)
- **Current test state**: none for the command-layer deletion orchestration. `repo::delete` has a CRUD test, and the TS slice has a happy-path delete test, but the Phase-1a system-persona guard, the cancel/force-cancel accounting, and the drain-timeout path have no coverage.
- **Scenario**: (a) `trust_origin == System` must be rejected with `AppError::Forbidden` — if this guard is removed or the enum comparison drifts, a user could delete the Director meta-persona and brick leadership/scoring. (b) The result counts (`executions_cancelled`, `executions_force_cancelled`, `cancel_failures`) drive the user-facing toast in `personaSlice.deletePersona` (lines 425-443); if force-cancel accounting regresses, the UI silently claims a clean delete while executions were actually orphaned.
- **Root cause**: Deletion logic depends on the engine + DB, so it was skipped rather than tested behind a seam.
- **Impact**: Irreversible deletion of a protected system persona; or silent data integrity loss (orphaned executions writing to about-to-be-CASCADE-deleted rows) reported to the user as success.
- **Fix sketch**: At minimum a focused unit test of the Phase-1a guard: seed a `System` persona via repo, assert `delete_persona_inner` returns `AppError::Forbidden` and the row still exists. If the engine is hard to fake, extract the result-accounting (mapping cancelled/force-cancelled/failure lists → `DeletePersonaResult`) into a pure helper and test that the counts are exhaustive (cleanly-cancelled + force-cancelled + failures == total running for the persona). Add a gate: no new `#[tauri::command] delete_*` ships without a guard test.

## 3. `personaSlice` dirty-switch guard + fetch-race seq invalidation are the data-loss safety net — and the store test only covers the happy path
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/personaSlice.ts:190-242 (`fetchDetail` seq guard + stale-cache clear), :449-488 (`selectPersona` dirty guard), :494-502 (`commit/cancelPendingSwitch`)
- **Current test state**: exists-but-weak — `personaStore.test.ts` covers `selectPersona` happy path, `clears selection when null`, and a happy-path delete. None of the race/guard branches are exercised.
- **Scenario**: The comments document the exact bug these branches prevent: "a late-arriving detail response overwrites reverted state". If `selectPersona`'s `isEditorDirty` short-circuit (sets `pendingSelectPersonaId` and bails) regresses, switching personas with unsaved edits silently fires `fetchDetail` for the new persona and clobbers the user's in-progress edits — a data-loss bug with no test. Likewise the `seq !== fetchDetailSeq` checks: an out-of-order/superseded detail response must be dropped; the failed-fetch branch must *clear* the stale `detailCache[id]` (lines 226-240) so the editor doesn't render a half-loaded persona.
- **Root cause**: These are concurrency/ordering invariants that don't surface in single-call happy-path tests.
- **Impact**: Silent loss of unsaved persona edits; editor rendering stale/partial data after a failed refresh.
- **Fix sketch**: Add slice tests using the existing `tauriMock` harness: (1) set `isEditorDirty=true`, `selectPersona("other")` → assert `pendingSelectPersonaId==="other"`, `selectedPersonaId` unchanged, and `get_persona_detail` NOT invoked for the new id; then `commitPendingSwitch()` → assert it now selects. (2) Fire two `fetchDetail` calls where the first resolves last → assert the later seq wins (stale response ignored). (3) `fetchDetail` rejects → assert `detailCache[id]` is deleted and `selectedPersona` is null. Invariant: *a superseded or failed detail fetch can never mutate `selectedPersona`/`detailCache` for the current selection.*

## 4. `duplicate` copies `model_profile`/icon verbatim and skips re-validation — no test pins the "copy must preserve encrypted profile and not corrupt the source" invariant
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/core/personas.rs:1301-1329 (`duplicate`); command wrapper at src-tauri/src/commands/core/personas.rs:300-324
- **Current test state**: none — `test_crud_persona` covers create/get/update/delete but not `duplicate`. The TS-side `duplicatePersona` test only asserts the IPC id round-trips.
- **Scenario**: `duplicate` does a raw column-list `INSERT...SELECT`. The encrypted `model_profile` (holding the auth token) is intentionally copied as-is. Two regressions slip through today: (a) if the column list drifts out of sync with the schema (a new sensitive column added but not listed, or list/order mismatch) the copy silently loses data or copies the wrong field — exactly the class of bug a schema migration introduces; (b) the duplicate must NOT mutate the source row (only `name`, `id`, timestamps change). Neither is asserted.
- **Root cause**: `duplicate` was added after the original CRUD test and never got its own coverage; the column list is hand-maintained with no test to catch drift.
- **Impact**: Duplicated persona with a broken/empty encrypted model profile (fails at run time, not at duplicate time), or accidental source mutation; both surface only in production.
- **Fix sketch**: Add a repo test: create a persona with a non-trivial `model_profile`, `max_budget_usd`, `icon`, `structured_prompt`; `duplicate`; assert the copy has identical field values (esp. `model_profile` decrypts to the same secret), name == `"<orig> (Copy)"`, a *different* id, and that the source row is byte-for-byte unchanged. Add a duplicate-then-duplicate test (name becomes `"X (Copy) (Copy)"`). Consider a gate that fails if the persona schema gains a column not present in the duplicate `SELECT` list.

## 5. Create-time name-collision suffixing (the TOCTOU-hardened loop) has no test for the suffix algorithm
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/core/personas.rs:593-630
- **Current test state**: none — the IMMEDIATE-transaction TOCTOU fix and the `"X" → "X (2)" → "X (3)"` suffix base-stripping logic are uncovered.
- **Scenario**: The loop strips trailing digits/parens to find the base name, then appends `(N)`. Edge cases that silently regress: a name that *already* ends in `" (2)"`, a name ending in digits that aren't a suffix (e.g. `"Bot 9000"`), and the 99-collision defensive ceiling. A bug here produces confusing duplicate names in the sidebar — the exact symptom this code was written to fix (per the 2026-05-05 comment: "five identically-named personas in the DB").
- **Root cause**: The suffixing string logic is entangled with the DB transaction, so it was never factored into a testable pure helper.
- **Impact**: Re-introduction of indistinguishable duplicate persona names; user confusion, mis-selection in lists.
- **Fix sketch**: Extract the base-name-stripping + next-suffix computation into a pure function `fn next_collision_name(base: &str, suffix: u32) -> String` and unit-test it (**llm-generatable** table test). Invariant: *for an input already suffixed `"X (2)"`, the next name is `"X (3)"`, not `"X (2) (2)"`; names ending in non-suffix digits keep their digits.* Add one integration-level repo test: create the same name twice in one project, assert the second is suffixed.

## 6. `slugify` (capability-id generator) is an unprotected invariant feeding persona capability IDs
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/agents/sub_new_persona/capabilityView/capabilityHelpers.ts:3-10 (used by CapabilityAddModal.tsx:91-96)
- **Current test state**: none
- **Scenario**: `slugify(title)` produces the `id` of a capability draft added to a persona (`uc_<slug>`). It lowercases, collapses non-alphanumerics to `_`, trims leading/trailing `_`, caps at 40 chars, and falls back to a timestamp-based id when the slug is empty. Two real invariants are unprotected: (a) the output is *always* a valid id shape (`uc_` prefix, no leading/trailing/edge `_` from the slice, never empty) — a regression that drops the empty-fallback yields `uc_` with an empty body and an empty-title bug; (b) a title that is all-symbols (`"!!!"`) must hit the timestamp fallback, not produce `uc_`.
- **Root cause**: Pure helper, never tested; the timestamp fallback also makes it non-deterministic, which is itself worth pinning.
- **Impact**: Malformed capability IDs collide or break downstream lookups; the empty-symbol case is an unhandled edge.
- **Fix sketch**: **llm-generatable** unit batch (deterministic — inject/freeze `Date.now` via `vi.useFakeTimers` for the fallback case). Invariants: output matches `/^uc_/`; never ends in `_`; length-bounded; all-symbol/empty input yields a non-empty body via the `cap_` fallback; whitespace/punctuation collapse to single `_`. Avoid snapshotting the exact timestamp string — assert the *shape*, not the value.

## 7. `validate_create_persona` / `validate_update_persona` (command layer) duplicate the repo validators with no parity test
- **Severity**: low
- **Category**: test-structure
- **File**: src-tauri/src/commands/core/personas.rs:62-114
- **Current test state**: exists-but-weak — the underlying `pv::validate_*` functions and the *repo's* `create`/`update` validation are tested (`personas.rs` repo tests + `validation/persona.rs` tests), but the command-layer `validate_create_persona`/`validate_update_persona` wrappers are a second, hand-maintained copy of the same field list with no test ensuring they stay in sync.
- **Scenario**: Validation now runs in *two* places (command wrapper and `repo::create`/`repo::update`). If a new validated field is added to the repo but forgotten in the command wrapper (or vice-versa), validation silently diverges — the command might accept input the repo rejects with a less friendly error, or skip a check entirely.
- **Root cause**: Duplicated validation logic across layers without a shared source of truth or a parity assertion.
- **Impact**: Inconsistent validation error surfaces; a field could lose its command-layer guard unnoticed.
- **Fix sketch**: Either (preferred) collapse to a single shared validator and delete the command-layer duplication, or add a small parity test that feeds a known-invalid input (e.g. empty name, NaN budget, out-of-range max_concurrent) through `validate_create_persona`/`validate_update_persona` and asserts the same rule fires as the repo path. Keep it as a thin regression net, not a giant backfill.
