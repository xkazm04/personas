# Pipeline & Agent Chains — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: pipeline-and-agent-chains | Group: Teams & Fleet Orchestration
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

## 1. Conditional skip does not propagate to non-conditional descendants — they run on the global pipeline input
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: stage-threading / silent-wrong-output
- **File**: src-tauri/src/engine/pipeline_executor.rs:1066 (resolve_node_input `0 => pipeline_input.clone()`); root in should_skip_node:204-220
- **Scenario**: Topology `A -> B -> C`, where `A->B` is a `conditional` edge and `B->C` is `sequential`. A runs; B's incoming condition is not met, so `should_skip_node(B)` returns true and B is marked `skipped` and **never inserted into `node_outputs`**. C's edge from B is sequential, so `should_skip_node(C)` is false and C executes. In `resolve_node_input(C)`, `predecessor_map[C] = [B]`, but B is absent from `node_outputs`, so `present.len() == 0` and the function falls back to `pipeline_input.clone()`.
- **Root cause**: A skip is recorded only as a status string; it is not propagated to descendants, and the absence of a predecessor's output is indistinguishable from "no predecessor", so the code silently substitutes the *original global pipeline input*. `should_skip_node` only inspects direct `conditional` edges, so a sequential child of a skipped node is never skipped.
- **Impact**: A branch that the operator deliberately gated OFF still runs everything downstream of the gate, fed with the pipeline's original input as if the gate node had produced it. C's output is wrong, is auto-committed to team memory (`create_node_memory`), and threads further downstream. The run still reports `completed`. This is exactly the "wrong output passed to next stage" failure the feature exists to prevent.
- **Fix sketch**: Track a `skipped: HashSet<member_id>`. In the per-node loop, if every predecessor of a node is skipped (or transitively skipped), skip the node too with `skip_reason: "upstream_skipped"` instead of falling back to `pipeline_input`. Alternatively, in `resolve_node_input`, distinguish "predecessor exists but produced no output / was skipped" from "no predecessors" and decline the global-input fallback when the node actually has predecessors.
- **Value**: impact=8 effort=5

## 2. Malformed node config sets `has_failure` then `continue`s — exactly one more node fully executes before the run halts
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: control-flow / wasted-execution
- **File**: src-tauri/src/engine/pipeline_executor.rs:807-809 (parse-fail `continue`) vs 983-985 (`if has_failure { break }`)
- **Scenario**: Node A has malformed `config` JSON. `parse_node_config` fails, the loop sets `has_failure = true` and `continue`s. The `continue` jumps to the next iteration, which has **no `has_failure` check at the top** — only at the bottom (line 983). So the next member B runs in full: approval gate, `run_node` (a real LLM/CLI execution with cost), and `create_node_memory`. Only *after* B completes does line 983 see `has_failure` and `break`.
- **Root cause**: The early-`continue` paths (parse failure) bypass the bottom-of-loop `if has_failure { break }`, and there is no top-of-loop guard. The result is an inconsistent fail-fast: a fatal config error fails the run yet still executes one more node.
- **Impact**: One wasted paid execution after a config error; B runs with input resolved from a predecessor (A) that produced nothing, so it falls back to `pipeline_input` (wrong input), and B's bogus output is persisted to team memory before the run is marked `failed`.
- **Fix sketch**: Either `break` instead of `continue` on parse failure (true fail-fast), or add `if has_failure { break; }` as the first statement inside the `for member_id` loop so no further node is dispatched once a fatal error is recorded.
- **Value**: impact=5 effort=2

## 3. A2A `message/send` has no idempotency — `messageId` is parsed but unused, so retries duplicate executions
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: A2A message duplication / undocumented idempotency contract
- **File**: src-tauri/src/engine/a2a/types.rs:93-95 (`message_id` `#[allow(dead_code)]`); consumed in src-tauri/src/engine/management_api.rs:1189 (`handle_message_send`)
- **Scenario**: An external A2A client sends `message/send`; the request is slow (a synchronous persona run can take minutes). The client's HTTP layer times out and retries with the **same `messageId`**. `handle_message_send` ignores `messageId` entirely and calls `run_persona_synchronous`, which creates a brand-new execution every time. The persona runs twice, doubling cost and any side effects (tools, PRs, notifications).
- **Root cause**: The whole point of the A2A `messageId` is correlation/de-duplication, but it is decoded into a dead field. There is no "have I already started an execution for this messageId?" guard, and `message/send` is a long-blocking call that invites retries.
- **Impact**: Duplicate, independent executions on client retry — wasted spend and duplicated real-world actions, with the client receiving only the second response. Undocumented: nothing states whether the surface is at-least-once or exactly-once.
- **Fix sketch**: Persist a `message_id -> execution_id` map (or a unique index on an `a2a_message_id` column). On `message/send`, if the `messageId` is already in flight or terminal, return the existing execution's result instead of starting a new one. Document the delivery guarantee in the module header.
- **Value**: impact=6 effort=4

## 4. Composite event scan cap silently drops the NEWEST events in a dense window
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent event drop / missed trigger
- **File**: src-tauri/src/engine/composite.rs:199-214 (`get_in_range(..., Some(COMPOSITE_EVENT_SCAN_LIMIT))`, ASC order)
- **Scenario**: An install emits more than `COMPOSITE_EVENT_SCAN_LIMIT` (5,000) events within the widest composite `window_seconds`. `event_repo::get_in_range` orders `created_at ASC` and caps at 5,000, so on a cap hit the loader keeps the **oldest** events and drops the **newest**. A composite trigger whose final condition (or last `sequence` step) was just satisfied by a very recent event will not see that event, so it does not fire even though its conditions are genuinely met.
- **Root cause**: Recency-driven matching combined with an ASC+limit query keeps exactly the wrong slice. The code warns when capped but still proceeds with the truncated set — the match is lost, not deferred.
- **Impact**: Composite triggers silently fail to fire under load (dropped downstream executions / handoffs). The near-miss diagnostics will even show fewer conditions met than reality, masking the cause.
- **Fix sketch**: For composite evaluation, load with `created_at DESC LIMIT N` (keep newest) then sort ascending in memory for sequence evaluation, or page through the window. Better: filter the SQL by the specific `event_type`s referenced in conditions so the 5,000-row budget is spent only on relevant events.
- **Value**: impact=5 effort=3

## 5. Chain cycle detection off-by-one — the originating persona is never added to `visited`, allowing one redundant re-execution of the cycle root
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: cyclic-chain / cycle-detection gap
- **File**: src-tauri/src/engine/chain.rs:236-239 (`next_visited` only pushes `trigger.persona_id`, the target)
- **Scenario**: Runtime cascade `A -> B -> C -> A` (created by direct DB insert or by toggling `enabled` after the fact, bypassing the create-time `detect_chain_cycle` guard). Fresh execution of A starts with `visited = {}` (source A not recorded). Hop A→B sets `visited={B}`, B→C sets `{B,C}`, C→A: A is **not** in `{B,C}`, so the cycle fires and A executes a **second time**. Only then is A added (`{B,C,A}`), so A→B is finally suppressed.
- **Root cause**: `visited_personas` accumulates only edge *targets*; the chain's root persona is never inserted, so a loop back to the root is detected one hop late. `MAX_CHAIN_DEPTH` (8) and the create-time BFS guard are the only backstops, but the latter runs only on trigger create/update, not at runtime.
- **Impact**: One full redundant (and potentially expensive) re-execution of the cycle's origin persona, plus its output polluting team memory, before the cycle is broken. Bounded, but a genuine correctness gap in the runtime backstop that is documented as "detect cycles".
- **Fix sketch**: Seed the visited set with `source_persona_id` before evaluating triggers (or push it into `next_visited` alongside the target), so a return edge to the root is caught on the first hop. Add a test for `A->B->C->A` asserting the root is not re-executed.
- **Value**: impact=5 effort=2
