---
layer: application
subject: pipeline-dag
technique: node-execution-model
stack: rust
---

# Node execution model — Rust pipeline executor

Where the technique lands in this repo: `src-tauri/src/engine/pipeline_executor.rs`
(the executor) and `src-tauri/src/commands/teams/teams.rs::execute_team` (run
creation + topological order), executing a team's authored node graph.

## What conforms

- **Topology → dispatch order in one computation.** `execute_team` builds the
  edge list (feedback edges excluded), runs
  `topology_graph::NamedTopologyGraph::topological_sort`, and refuses to
  execute on a cycle — emitting `PIPELINE_CYCLE_WARNING` with
  `cycle_member_ids` named (`teams.rs:260-295`). The sort's order *is* the
  execution order handed to `run_pipeline` — proof and plan are the same
  artifact, exactly as the technique prescribes.
- **Readiness from data.** `build_predecessor_map` (`pipeline_executor.rs:115-127`)
  derives predecessors purely from stored connections;
  `resolve_node_input` and `all_predecessors_skipped` read only
  `node_outputs`/`skipped` state. Fan-in merges every present predecessor
  output into a structured `{ "inputs": { member_id: output } }` payload
  (`pipeline_executor.rs:1111-1136`) instead of silently picking one branch —
  a defect the file's own comment records as previously shipped.
- **Persist, then broadcast, honestly.** `StatusEmitter::emit`
  (`pipeline_executor.rs:64-108`) writes `node_statuses` to the run row and
  then emits `PIPELINE_STATUS`; a failed DB write is warn-logged as a named
  UI/store divergence rather than swallowed.
- **Skip is not failure.** Conditional-edge misses write `status: "skipped"`
  with `skip_reason: "condition_not_met"`; transitive skips write
  `"upstream_skipped"` (`pipeline_executor.rs:849-886`) — the skip carries
  its predicate.
- **Per-class deadlines, execution-time-counted.** Persona (model) nodes
  budget 600s of *running* time and 3600s total wall-clock — queued time
  waiting for an admission slot explicitly does not burn the node's deadline
  (`pipeline_executor.rs:456-465`), the exact rule the technique's last
  decision rule states. Command nodes carry their own 300s ceiling. Timed-out
  executions are cancelled, not orphaned (`pipeline_executor.rs:539-546`).
- **Budget enforced at dispatch.** `run_budget::ledger().should_halt` is
  checked before each node launch (`pipeline_executor.rs:819-826`).

## Where it deviates from the standard (kept, reported)

- **No resume — restart recovery is fail-and-sweep.** Run state (`statuses`,
  `node_outputs`, `skipped`) lives in the spawned task's memory; the DB gets
  status snapshots but the loop cannot be reconstructed from them. Startup
  runs `recover_interrupted_pipeline_runs` (`lib.rs:838-849`), which marks
  `running`/`awaiting_approval` runs **failed** — including runs parked on a
  human gate, since the approval flag is an in-memory `AtomicBool` in
  `ActiveProcessRegistry` (`pipeline_executor.rs:716-749`). Registered at
  `#w2-hitl-approval`; this file is its restart-recovery evidence.
- **Fail-fast overloads "skipped".** After a failure or cancel, remaining
  `idle` nodes are relabeled `skipped`/`cancelled` wholesale
  (`pipeline_executor.rs:1048-1065`) — blocked-by-upstream-failure is
  distinguishable from branch-not-taken only by the *absence* of a
  `skip_reason` field, where the standard wants a distinct `blocked` status.
- **No single status authority.** `"idle"`, `"running"`, `"completed"`,
  `"failed"`, `"skipped"`, `"cancelled"`, `"awaiting_approval"`,
  `"rejected"` are inline string literals throughout the executor and its
  frontend consumers — no enum owns the vocabulary
  (one-authority-per-vocabulary gap).
- **Parallelism is the degenerate bound.** The loop is strictly serial over
  the topological order; independent branches never run concurrently. Legal
  under the standard (bound = 1) but leaves the DAG's parallelism unused.

## Worth stealing

The queued-vs-running timeout split and the fan-in `{ inputs }` merge are
both one-screen changes that fix silent, plausible-looking wrong results —
the most transplantable pieces of this file.
