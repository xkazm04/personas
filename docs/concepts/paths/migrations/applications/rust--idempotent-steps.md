---
layer: application
subject: migrations
technique: idempotent-steps
stack: rust
---

# Idempotent steps in the ledger-less boot chain

This repo is the standard's **ledger-less variant in production**: there is
no version counter anywhere (`src-tauri/db/src/backup.rs:15-17` states it
outright — "There is no schema-version counter in this codebase"), so the
full chain — `migrations::run` + `run_incremental`
(`src-tauri/db/src/lib.rs:332-333`) — replays on every launch of every
install. Every guard is load-bearing, which makes this codebase a complete
tour of the technique: the discipline done right, the hazard fired for
real, and the chain-level failure no per-step property could see.

## The step record and the legal probes

`IncrementalMigration` (`src-tauri/db/src/migrations/incremental/:5-10`)
is `{ id, description, already_applied, apply }`; `run_step` (`:12-24`)
evaluates the guard, short-circuits or applies, and logs. Note what it does
NOT do: record anything — `id` is a log field only. The three legal guard
probes read the *live schema*: `has_column` (`:40-47`), `has_table`
(`:49-56`), `has_index` (`:76-83`). All three return `Ok(false)` for a
missing table — the guard resolves uncertainty toward *running* the step,
whose failure is loud, exactly the bias the standard prescribes. 123
`run_step` sites use this shape. `ddl_step` (`:33-38`) supplies the atomic
unit per step.

## The hazard, fired: swallowed guards

The standard's "a guard that skips is indistinguishable from a guard that
succeeded" happened here twice, in both flavors:

- **Swallow-everything guards.** Steps used `let _ = ddl_step(…)` to absorb
  the expected "duplicate column" on re-run — and absorbed every real error
  with it. Six load-bearing sites were fixed, and the regression test
  `a_genuinely_failed_guarded_alter_is_no_longer_swallowed`
  (`incremental.rs:8765-8791`) pins the fix: it drops the target table,
  runs the chain, and asserts the error *surfaces and names the table* and
  that the chain did NOT sail past (the next step's table must not exist).
  The compliant replacement shape is `incremental.rs:2218-2228`: probe with
  `has_column`, making the duplicate impossible, "which means anything that
  still errors here is real and propagates."
- **The residue.** 42 production `let _ = ddl_step(` sites remain below the
  test module (counted by grep, lines < 8596), plus 13
  `let _ = conn.execute_batch(` ALTERs in
  `src-tauri/db/src/migrations/initial.rs` (e.g. `:14-32`). Some are argued
  (the `DROP COLUMN` batch at `:7791-7809` documents why swallowing is the
  success path there); most are simply the pre-fix pattern still standing.
  One site *inverts* the uncertainty bias: `incremental.rs:7718` guards
  with `has_column(…).unwrap_or(true)` — probe failure is treated as
  "already applied" and the step is skipped, the exact quiet branch the
  standard forbids.

## The chain-level failure: oscillation

The standard's claim that idempotent steps do not compose into a convergent
chain is not hypothetical here. `retire_persona_groups`
(`incremental.rs:3659-3708`) drops columns that two *additive* guarded
steps 350 lines upstream kept re-adding; with the destructive step's guard
written as `already_applied: |_conn| Ok(false)` (always-run), the pair
cycled add→drop on every boot — ~186 ms and two full table rewrites per
launch, forever, with every individual step reporting honest success. The
fix (2026-08-15) is all three repairs from the standard at once: the
additive steps were deleted (`:3308-3312`, `:3349-3351` document the
removal), and the destructive step's guard became a **post-condition
probe** (`:3678-3682`) that asserts the retired state. The in-code
post-mortem (`:3669-3672`) states the transplantable lesson verbatim: "The
defect was a relationship between steps 370 lines apart, which no per-step
instrument can see."

One always-run guard legitimately remains: `groups_to_teams_data_migration`
(`:3565-3573`) has no clean boolean marker (zero groups is a legitimate
no-op), so it leans entirely on internally idempotent statements
(`NOT EXISTS` / `IS NULL` guards, deterministic derived ids at `:3563`) —
the "replayable phrasing" escape hatch, paid for with a real data scan on
every boot.

## The fixed-point instruments

Two tests approximate the standard's "run the chain twice, assert zero
work": the rebuild-idempotency assertion (`incremental.rs:8740-8755`)
replays the chain and asserts the `persona_executions` CHECK was not
re-widened (a second widening means the guard failed and user history was
re-copied on boot); and `fresh_schema_contains_latest_migration_artifacts`
(`:8848` ff.) pins that a fresh store actually receives the newest steps'
artifacts — the fresh-install half of convergence. What does not exist yet
is the general form: a full chain-runs-twice/second-pass-does-nothing
assertion, and any instrument on the steady-state probe tax (the legacy
audit `docs/concepts/golden-paths/boot-migration-step.md` measured 436
statements re-prepared and 157 schema probes per launch at its commit).
