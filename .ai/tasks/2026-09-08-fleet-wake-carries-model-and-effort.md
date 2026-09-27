# Task: a woken fleet session keeps the model and effort its plan chose

- **Registry subject / technique:** software-engineering / model-routing / cache-continuity
- **Run:** intake-gpt6astra-0908 (2026-09-08)
- **Status:** done 2026-09-28, run dp-mae-0927 (agent-operations /
  model-and-effort-selection / pin-the-resolved-configuration); see "Done" at the end

## The seam

A fleet-plan row carries `model` and `effort` and renders them into the spawn
argv (`src-tauri/src/commands/companion/approvals/approval_exec_fleet.rs`,
`FleetPlanRow::args`). The session registry keeps only the conversation id and
the cwd (`src-tauri/src/commands/fleet/commands.rs`, `resume_target`), and
`fleet_wake_session` spawns a bare `--resume <id> <continuation>` with no
flags. Six call sites wake sessions this way (companion approvals, the
companion API, the staleness ticker). A row spawned at `--effort high` on a
non-default model is woken at the CLI defaults.

## Why it matters (measured)

Paired headless experiment, 2026-09-08, Claude Code 2.1.263: resuming a session
at the same effort read 33,353 cached tokens and wrote 59 (USD 0.0070); resuming
with the effort raised one step read 23,997 and wrote 9,415 (USD 0.0425, 6.1x).
The effort lives in the system layer of the prefix. Every wake today is an
unrequested flip when the plan chose a non-default: a ~9.4K-token rewrite, and a
session silently running at a different effort (and possibly model) than planned.

## The change

1. Add `spawn_flags: Vec<String>` (or `model: Option<String>`, `effort:
   Option<String>`) to the registry session row; populate at `spawn_session_named`
   from the caller's args (only `--model`/`--effort` values, per `naming::VALUE_FLAGS`).
2. `resume_target` returns them beside the conversation id and cwd.
3. `fleet_wake_session` pushes them ahead of `--resume` (order: flags, then
   `--resume <id>`, then the continuation prompt; `pty::spawn_session` appends
   `--mcp-config` after).
4. Test beside `label_model_and_effort_ride_through_validation_into_argv`: a row
   spawned with `--effort high` and hibernated wakes with `--effort high` in argv.

**Size:** ~4 files, ~40-60 lines. **Gate:** `cargo test -p personas --
fleet::` (the pty/headless argv tests). **Measurable:** the woken turn's
`cache_creation_input_tokens` on a plan-row session; today ~9.4K, after ~0.

## Why the first step was not taken this run

The change touches the registry row schema and four call paths; the tree carried
uncommitted work in unrelated files at the time, and the intake budget for a
listicle-class source does not cover a schema change. Next `/intake apply
cache-continuity --project personas --mode code` executes steps 1-4 on a branch
`direction/fleet-wake-flags`.

## Done (2026-09-28, run dp-mae-0927)

Smaller than planned: no schema change. The registry row already holds the spawn
`args` (persisted as `args_json`), so step 1 was unnecessary. `resume_target`
now returns `pinned_config_args(&s.args)` beside the id and cwd, and
`fleet_wake_session` puts those pairs ahead of `--resume`. The woken row's args
carry them, so a second wake keeps them too.

Re-measured first on Claude Code 2.1.283, paired headless: a bare resume keeps
the conversation's model (the CLI restores it) but not its effort. The resumed
turn wrote 11,295 and 6,157 cache-creation tokens, against 55 and 55 with
`--model/--effort` carried, and 55 with `--effort` alone. The model is carried
anyway, because the restoration is CLI behaviour nobody pinned.

Gate: `node scripts/build/run-rust-tests.mjs -- commands::fleet::registry::tests`,
37 passed. The two new tests are `pinned_config_args_keeps_model_and_effort_in_either_form`
and `resume_target_carries_the_spawned_model_and_effort`. Mutation (resume_target
returning no flags) turns the second red.
