---
layer: application
subject: sql-console
technique: safe-mode-guarding
stack: rust
---

# The authoritative guard in the Rust executor

The trusted side of the two-sided guard is `execute_query_cancellable` in
`src-tauri/src/engine/db_query.rs:501-541`, reached from the single Tauri
command `execute_db_query` (`src-tauri/src/commands/credentials/db_schema.rs:216`,
`#[requires(privileged)]`). Every console author — the Console tab, the
saved-query editor pane, and the NL chat lane — calls that one command.

## Where the gate stands

```rust
// db_query.rs:517-541 (abridged)
if !allow_mutation && is_mutation(query_text) {
    return Err(AppError::Validation("This query appears to modify data … \
        Enable write mode or confirm the mutation to execute it."));
}
if !allow_mutation && has_multiple_statements(query_text) {
    return Err(AppError::Validation("Multiple SQL statements are not allowed \
        in safe mode. Run one statement at a time, …"));
}
let credential = cred_repo::get_by_id(pool, credential_id)?;
```

Both checks run on `query_text` — the exact `&str` that the per-family
driver receives a few lines later — *before* the credential is even loaded.
The gate sees its target; nothing between the check and the dispatch
rewrites the string. `allow_mutation` defaults to `false` at the command
boundary (`db_schema.rs:235`, `allow_mutation.unwrap_or(false)`), so a
caller that forgets the flag gets safe mode, not write mode.

## The classifier survives obfuscation

`is_mutation` (`db_query.rs:383-403`) is built from three tokenizer-grade
helpers, all in the same file:

- `extract_first_keyword` (`:251`) strips leading line and block comments
  and whitespace before reading the verb — so `/* UPDATE nothing */ SELECT
  1` is a read, and `ATTACH/**/DATABASE` cannot hide its verb from a
  separator trick (the deny-list at `:2582-2602` reuses the same function
  for exactly that reason, per its comment).
- An unclosed block comment returns the sentinel `"__UNCLOSED_COMMENT__"`,
  which `is_mutation` maps to `true` (`:386`, "fail-safe") — the fail-closed
  rule for unparseable input.
- `WITH` does not short-circuit to "read": `cte_body_has_mutation` (`:340`)
  runs `strip_sql_literals` (`:298`, single-quoted, double-quoted, and
  dollar-quoted forms) and then token-splits the remainder on
  non-`[A-Za-z0-9_]` and tests each token against `CTE_MUTATION_VERBS`
  (`:290-292`: DELETE, INSERT, UPDATE, MERGE, REPLACE, UPSERT, TRUNCATE,
  DROP, ALTER). Token-exact matching is why `updated_at` and `deleted` do
  not false-positive; literal stripping is why `WHERE note = 'DELETE FROM
  t'` does not either. The unit tests at `:3099-3115` pin all three cases.

## One statement per request in safe mode

`has_multiple_statements` (`:328-334`) strips literals, trims a trailing
`;`, and asks whether a `;` remains. The comment at `:526-534` records the
reason it exists: the raw pass-through connectors forward the whole payload
verbatim, so `SELECT 1; DELETE FROM users` would classify as a read by its
first statement and the tail could execute if the endpoint honors stacked
statements. Safe mode therefore refuses batches outright; write mode is
exempt because the user has confirmed a mutation.

## Bounds the guard travels with

The same executor bounds what a permitted statement can cost: `QUERY_TIMEOUT
= 60s` (`:32`), `MAX_ROWS = 500` (`:27`) injected as `LIMIT 501` when a read
carries no top-level `LIMIT` (`:100-121`, literal-stripped scan for an
existing `LIMIT`), `MAX_RESPONSE_BYTES = 8 MB` on the transport (`:48-62`),
and a `CancellationToken` threaded through to an interrupt handle on the
local engine path (`run_local_sqlite_guarded`, `:2464`). Failures pass
through `sanitize_error` (`:144`), which redacts every credential field
value regardless of length.

## The gap the counter-evidence shows

The executor's parameter is a raw `&str`, and the repo has a second door
that never met it: `src-tauri/src/companion/jobs/connector_use.rs:1443-1469`
guards a model-authored mutation lane with `lower.starts_with(v)` over seven
verbs including `drop`, then calls the driver directly. Nothing in the type
system required that lane to pass through `is_mutation`. That is the
"executor demands a classified statement" section of the technique,
motivated by measurement rather than taste.
