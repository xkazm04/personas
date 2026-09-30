---
subject: admission-queue
evidence:
  - src-tauri/engine/src/queue.rs                        # AdmitResult closed 3-way verdict; priority levels; per-tenant + global caps; bounded depth with refuse-newest shed; wait_ms stamped at promotion; quota + resource gates composed into one verdict
  - src-tauri/src/engine/resource_governor.rs            # host CPU/memory admission gate: asymmetric per-signal watermarks, hysteresis, first-sample skip, logged transitions
  - src-tauri/src/engine/mod.rs                          # verdict handling per outcome; queue status events on queued/promoted; durable queue rows — restart re-admits queued through the normal gate, revokes running with an explicit reason
  - src-tauri/engine/src/test_runner/                  # bounded fan-out cap on parallel cells — the permit-based admission posture (wait, never refuse), documented and bounds-tested
counter_evidence:
  - src-tauri/src/commands/infrastructure/task_executor.rs   # durable "running" marker written BEFORE the admission door — refusal strands the row in running forever
deviations:
  - w8-admission-queue   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Admission Queue - evidence

How this codebase measures against the [`admission-queue`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
