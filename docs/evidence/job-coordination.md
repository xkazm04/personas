---
subject: job-coordination
evidence:
  - src-tauri/core/src/models/build_session.rs            # closed phase vocabulary, strict parse, validate_transition table, is_terminal classifier, AwaitingInput paused state
  - src-tauri/db/src/repos/core/build_sessions.rs         # append-only phase-timing history; expire_stale_non_terminal: corroborated age expiry w/ recorded vocabulary-reuse rationale
  - src-tauri/src/engine/mod.rs                           # recover_stale_executions + requeue_persisted_executions: per-class boot verdicts (fail mid-run w/ reason; preserve+re-admit queued through the normal door)
  - src-tauri/db/src/repos/resources/n8n_sessions.rs      # recover_interrupted_sessions: parks awaiting_answers, fails live classes w/ actionable reason, returns ids so in-memory registries get purged
  - src-tauri/src/daemon/lock.rs                          # heartbeat lease: 90s stale = 3 missed 30s heartbeats — TTL sized to detection latency, not job duration
  - src-tauri/src/engine/leadership.rs                    # two-way renewal (relinquish on heartbeat write failure), follower takeover tick, explicit release on clean shutdown
counter_evidence:
  - src-tauri/db/src/repos/resources/teams.rs             # recover_interrupted_pipeline_runs: blanket wholesale fail of running AND awaiting_approval — the paused-destroying form
deviations:
  - w11-job-coordination   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w8-pipeline-dag      # boot recovery wholesale-fails awaiting_approval (paused) alongside running — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-background-jobs   # event-pipeline claims carry no holder/timestamp/lease, forcing the heuristic two-snapshot reaper — anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Job Coordination - evidence

How this codebase measures against the [`job-coordination`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
