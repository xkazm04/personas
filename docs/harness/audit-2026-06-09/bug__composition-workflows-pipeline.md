# Bug Hunter — composition-workflows-pipeline
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

> Scope note: The task's TS paths (`src/features/pipeline/...`) do not exist; the canvas lives at `src/features/teams/sub_canvas/` and `src/features/teams/sub_teamWorkspace/TeamCanvas.tsx`. `TeamCanvas.tsx` is now a stub — its own header comment declares the React-Flow DAG canvas (`sub_canvas/`) "orphaned and slated for removal," and it renders `TeamStudioSplitVariant` instead. The **live** A2A/composition graph executor is `src-tauri/src/engine/pipeline_executor.rs` + `commands/teams/teams.rs::execute_team` + `engine/topology_graph.rs`, so the highest-value graph-integrity findings are there. In-scope Rust (`composite.rs`, `a2a/`, `composition_workflows.rs`, `composition_workflow.rs`) are thin/correct; findings below are in the executor that those graph definitions feed.

## 1. Cycle nodes are executed anyway instead of being refused
- **Severity**: critical
- **Category**: graph-cycle
- **File**: src-tauri/src/commands/teams/teams.rs:270-288
- **Scenario**: A team has a non-feedback cycle A→B→C→A (the canvas/connection layer only blocks *self*-loops at `teams.rs:487`, not multi-node cycles when edges are created across separate transactions). User clicks Execute. `topological_sort()` returns `order=[]` (or the acyclic prefix) and `cycle_nodes=[A,B,C]`. The code logs a warning, emits `PIPELINE_CYCLE_WARNING`, then does `execution_order.extend(sort_result.cycle_nodes)` and runs the pipeline anyway.
- **Root cause**: Cycle detection is treated as advisory, not a hard stop. Appending cycle members to the linear execution order does not resolve the cycle — it just runs the cyclic nodes once in an arbitrary `HashMap`/insertion order with none of their true upstream outputs available (`node_outputs` for an in-cycle predecessor is never populated before the node runs), so every cyclic node executes with `resolve_node_input` falling back to the global `pipeline_input`. The "warning + run" path produces a result that *looks* successful but is semantically garbage.
- **Impact**: corruption (silent wrong inputs to every cyclic agent; auto-created team memories from those runs poison future runs), plus wasted LLM spend and a green "completed" status hiding a broken graph.
- **Fix sketch**: Make a cyclic graph un-runnable at the boundary: if `sort_result.has_cycle()`, mark the run `failed` with the cycle node IDs and return, never extending `execution_order`. Enforce acyclicity at edge-creation time inside the existing `BEGIN IMMEDIATE` transaction (full DAG check, not just self-loop), so a cycle can never be persisted in the first place.

## 2. Any single node failure aborts the entire pipeline, including independent parallel branches
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/engine/pipeline_executor.rs:863-877
- **Scenario**: Graph is two independent chains sharing no edges: A→B and X→Y. Execution order is `[A,X,B,Y]` (or any interleaving). Node A fails. The loop sets `has_failure = true` and `break`s. X, B, and Y never run even though X/Y have nothing to do with A. Worse, with `[A,B,X,Y]` ordering, A's failure kills X/Y which are a totally separate branch.
- **Root cause**: Failure handling is global (`break` out of the whole node loop on `has_failure`) rather than per-branch. The executor has no notion of "which downstream nodes are reachable from the failed node" — it conflates "this node's subtree must stop" with "the whole pipeline must stop." A fan-out into parallel branches cannot survive one branch failing.
- **Impact**: UX degradation / lost work — a transient failure in one agent silently cancels unrelated agents; the run is marked `failed` and every not-yet-run node is relabeled `skipped` (line 879-896), erasing the fact that they were viable.
- **Fix sketch**: Replace the global `break` with reachability-based pruning: on node failure, compute the set of nodes transitively downstream of the failed node (via the predecessor map / adjacency) and mark only those `skipped (upstream_failed)`; continue executing nodes not reachable from any failure. Only finalize as `failed` if a node with no surviving path remains, but let independent branches complete.

## 3. A node whose required upstream was skipped still runs — with the global input instead of its (absent) predecessor output
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/engine/pipeline_executor.rs:727-738, 925-940
- **Scenario**: Conditional edge A→B fails its condition, so B is marked `skipped` and never produces output (`node_outputs` has no entry for B). B→C is a plain `sequential` edge. `should_skip_node("C", …)` only returns true for unmet *conditional* edges, so C is **not** skipped. `resolve_node_input` for C does `predecessor_map.get("C") = [B]`, `node_outputs.get("B") = None`, so the `find_map` yields nothing and falls back to `pipeline_input.clone()`.
- **Root cause**: "Skipped" does not cascade. The skip predicate is evaluated per-node against *conditional* edges only; it has no concept of "my predecessor was skipped/failed, therefore I have no real input." Combined with `resolve_node_input`'s silent fallback to the pipeline-level input, C runs as if it were a root node, consuming the original pipeline input rather than the output it was wired to depend on.
- **Impact**: corruption — C executes against the wrong data and reports `completed`; a conditional branch that should have pruned its whole subtree instead leaks the pipeline input into the middle of the graph.
- **Fix sketch**: Track a per-node "viable" flag. When a node is skipped or failed, mark all transitively-downstream non-feedback successors skipped (`upstream_skipped`). In `resolve_node_input`, distinguish "node is a true root (no predecessors)" from "node has predecessors but none produced output" — the latter should skip, not silently borrow `pipeline_input`.

## 4. Fan-in node consumes only ONE predecessor's output; all other upstream outputs are silently dropped
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/engine/pipeline_executor.rs:925-940
- **Scenario**: Diamond graph: A→C, B→C (C fans in from two agents). Both A and B complete. `resolve_node_input("C", …)` does `preds.iter().rev().find_map(|pid| node_outputs.get(pid)…)` — `find_map` returns on the **first** predecessor (in reverse order) that has output. Only one of A's/B's outputs reaches C; the other is discarded with no warning.
- **Root cause**: The resolver was written for the linear/sequential case and models a node as having a single effective input. There is no merge/aggregation step for multiple predecessors, and `rev() + find_map` makes the choice both lossy and dependent on `predecessor_map` insertion order (which derives from connection `created_at` order), so which branch "wins" is incidental.
- **Impact**: corruption — a synthesis/aggregator agent (the entire point of a fan-in) only ever sees one of its inputs; results look plausible but are missing data. Non-deterministic on edge-creation order.
- **Fix sketch**: When a node has >1 predecessor with output, build a structured multi-input payload (array/object keyed by source member id) and pass that to `build_node_input` instead of picking one. At minimum, log when multiple predecessor outputs exist and only one is forwarded.

## 5. Fail-open condition evaluation lets a malformed/unknown conditional edge pass, defeating branch gating
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/engine/pipeline_executor.rs:139-186
- **Scenario**: A conditional edge has a `condition` whose JSON fails to parse (bad field name, truncated string from a localStorage→SQLite migration, or an operator the build doesn't recognize like `greater_than`). `evaluate_condition` logs a warning and `return true` (malformed → fail-open; unknown op → fail-open). `should_skip_node` therefore never skips, so the gated branch runs unconditionally.
- **Root cause**: Fail-open is the wrong default for a *gate*. The comment justifies it as "so pipelines don't break on bad config," but the consequence is that a misconfigured guard silently disables itself — a guarded destructive/expensive branch fires when the author intended it to be conditional. There is no surfacing of "this edge's condition is invalid" to the run status; it's only a log line.
- **Impact**: UX degradation / unintended execution — conditional routing silently becomes unconditional; cost and side effects the author tried to gate happen anyway.
- **Fix sketch**: For a *gating* condition, fail-closed (skip the branch) or, better, surface a `node_status: failed (invalid_condition)` so the run visibly stops on bad config rather than quietly bypassing the gate. Validate condition JSON + operator at edge-creation time so malformed conditions can never be persisted.

## 6. Approval-gate poll uses a shared registry key that collides with pipeline cancel, and times out a long human review after exactly 1 hour
- **Severity**: critical
- **Category**: race-condition
- **File**: src-tauri/src/engine/pipeline_executor.rs:637-663, 742-803
- **Scenario**: `poll_for_approval` registers in `ActiveProcessRegistry` under domain `"pipeline_approval"` with key `"{run_id}:{member_id}"`, and `approve_pipeline_node` flips that flag via the registry's `cancel_run` mechanism. The same registry also holds the pipeline's own cancellation flag under domain `"pipeline"`/`run_id` (registered at teams.rs:317-319). The approval loop checks `cancelled.load(...)` (the pipeline flag) AND `flag.load(...)` (the approval flag). If a user cancels the whole pipeline while a node awaits approval, the loop returns `Cancelled` and the node is marked `rejected`/has_failure — but if the two registry domains are ever keyed or unregistered inconsistently (the approval key embeds `run_id`, and `unregister_run("pipeline_approval", key)` runs on every exit path), a re-entrant approval poll for a second gate in the same run reuses overlapping run-scoped state. Separately, line 647 polls only `0..3600` (1 second each): a node legitimately awaiting human approval is force-`rejected` with "Approval timed out (1 hour)" and `break`s the pipeline (line 798-800) even though nothing went wrong.
- **Root cause**: The approval handshake overloads the cancellation registry (a flag designed for "stop this process") to mean "human approved." Approval and cancellation share the same boolean primitive, so the only thing distinguishing approve from cancel is *which* domain/key was signalled — fragile, and untestable in isolation. The 3600-iteration cap turns a normal human-in-the-loop pause into a hard pipeline failure.
- **Impact**: data loss / UX degradation — an overnight or out-of-hours approval silently fails the entire run after an hour; a mis-routed cancel could be read as an approval (or vice-versa) given the shared primitive.
- **Fix sketch**: Give approval its own dedicated signalling channel (e.g. a `oneshot`/watch channel or a distinct registry domain with a 3-state enum: Pending/Approved/Rejected) separate from cancellation, so "approved" and "cancelled" are never the same bit. Make the approval wait unbounded (or configurable) and persist `awaiting_approval` so an app restart can resume the gate instead of treating elapsed wall-clock as failure.
