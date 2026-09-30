---
subject: agent-chaining
evidence:
  - src-tauri/engine/src/team_handoff.rs                              # visual edge → emitter chain trigger + receiver listener, two rows on the target; idempotent skip-if-exists; feedback edges never wired
  - src-tauri/db/src/chain.rs                                         # cascade evaluator: depth-8 / breadth / cost ceilings, visited-set cycle guard, machinery-stamped provenance (_chain_depth/_chain_visited/_chain_trace_id/_chain_cost_usd), 15-token stop vocabulary, mark-before-publish CAS
  - src-tauri/db/src/repos/execution/chain_stop_reasons.rs            # the stop ledger: typed reason + detail + chain coordinates, queryable per chain trace
  - src-tauri/src/engine/mod.rs                                       # chain id minted at root from own trace id, forwarded verbatim; root back-fills its own trace row so it is a member of its own chain
  - src/features/agents/sub_executions/detail/chain/ChainTraceView.tsx  # chain rendered per chain trace id with total cost, explicit `partial` flag, and stop reasons resolved from the token vocabulary
counter_evidence:
  - src-tauri/engine/src/team_handoff.rs                              # wiring is append-only: a deleted drawn edge never de-wires its trigger/listener rows — the orphaned-listener ghost the translation technique exists to prevent
deviations:
  - w10-agent-chaining   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Agent Chaining - evidence

How this codebase measures against the [`agent-chaining`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
