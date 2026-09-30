---
subject: pipeline-dag
evidence:
  - src-tauri/src/engine/pipeline_executor.rs          # predecessor map, conditional edges + transitive skip propagation, per-transition persist+emit, approval gate that waits indefinitely, command nodes beside model nodes, fan-in input merge, per-run budget halt at dispatch
  - src-tauri/src/commands/teams/teams.rs              # run-start topo sort; cycle refusal with the cycle's member ids named; BEGIN IMMEDIATE single-run-per-graph guard
  - src-tauri/src/engine/automation_runner.rs          # external dispatch: SSRF-validated endpoint, auth resolved before the run record exists, run record brackets the wire, typed audit row
  - src-tauri/src/engine/platforms/deploy.rs           # save-on-success-only: local automation row created after the remote confirms; created-but-not-activated recorded honestly
  - src-tauri/src/engine/platforms/n8n.rs              # per-adapter target policy: base endpoint pinned from credential, path ids validated alphanumeric before interpolation
counter_evidence:
  - src-tauri/src/engine/pipeline_executor.rs          # evaluate_condition fails OPEN — a malformed condition or unknown operator silently fires the branch (the unevaluable≠verdict rule violated toward true)
deviations:
  - w8-pipeline-dag   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-hitl-approval    # pipeline approval pending state in-memory; restart sweep fails running/awaiting_approval runs instead of resuming — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-retry-backoff    # registered "retryable set omits 429" — 429 since added in code (2026-08-16); the Retry-After hint remains unread, so the residual stands
---

# Pipeline Dag - evidence

How this codebase measures against the [`pipeline-dag`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
