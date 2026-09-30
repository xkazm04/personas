---
subject: health-checks
evidence:
  - src-tauri/src/commands/infrastructure/system/health.rs         # per-check status enum + remediation string + installable flag; all_ok is worst-of; keyring/db scratch round-trip probes
  - src-tauri/src/engine/healthcheck.rs                            # Verified/Unverifiable/Failed three-state; 5s deadline that kills the hung child; sweep buckets counted on typed state, not the legacy boolean; stamp-before-sweep daily cadence
  - src-tauri/src/commands/infrastructure/system/binary_probe.rs   # one TTL cache shared by every caller that probes the same executables; probe runs outside the lock
  - src/features/overview/components/health/SystemHealthPanel.tsx  # refresh affordance; re-runs checks after an applied install — the fix's success claim is the re-probe
  - src/features/agents/sub_health/useHealthCheck.ts               # penalty-weighted composite with shared grade cutoffs; a sub-check that could not run discloses the score as incomplete
  - src/features/agents/sub_health/useHealthDigestScheduler.ts     # weekly digest cadence; corrupt-stamp-means-due-once; one-attempt-per-session latch against retry storms
  - src/features/vault/shared/hooks/health/useCredentialHealth.ts  # three-layer result storage with declared priority; persisted fallback explicitly marked stale
counter_evidence:
  - docs/concepts/golden-paths/connection-health-check.md          # measured: the live-run 401/invalid_grant path logs but never writes the health record — in-band evidence weaker than the scheduled probe, inverted hierarchy
deviations:
  - w4-health-checks   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Health Checks - evidence

How this codebase measures against the [`health-checks`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
