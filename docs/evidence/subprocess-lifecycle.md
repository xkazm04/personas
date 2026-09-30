---
subject: subprocess-lifecycle
evidence:
  - src-tauri/engine/src/cli_process.rs                  # one spawn door: shared envelope, kill-on-drop backstop, EOF-vs-silence read primitive, deliberate executable resolution
  - src-tauri/engine/src/prompt/cli_args.rs              # argv/env construction in one place; nested-deadline alignment (inner API timeout derived from outer kill ceiling)
  - src-tauri/engine/src/process_activity.rs             # activity events keyed by run_id — the shared-key collapse documented in the serde comment
  - src-tauri/engine/src/session_pool.rs                 # warm sessions: canonical config fingerprint, TTL, consume-once, invalidate on change/failure
  - src-tauri/engine/src/queue.rs                        # layered caps: global + per-tenant, bounded queue with backpressure, quota + resource admission gates
  - src-tauri/src/engine/resource_governor.rs            # pressure-aware admission with hysteresis and asymmetric per-signal watermarks
  - src-tauri/src/commands/fleet/stale.rs                # eviction-side live-slot cap (soft, never evicts working sessions) + stall/frozen detection
  - src-tauri/src/webbuild/devserver.rs                  # process-tree kill; verify-identity-before-kill on the crash-orphaned lock
  - scripts/build/guard-concurrent-cargo.mjs             # machine-scoped exclusion across host instances via stateless live-population check, fail-open loudly
counter_evidence:
  - src-tauri/src/commands/fleet/process_scan.rs         # orphan detection by name/cmdline heuristic — the identity-marker sweep the standard prescribes does not exist
deviations:
  - w4-subprocess-lifecycle   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Subprocess Lifecycle - evidence

How this codebase measures against the [`subprocess-lifecycle`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
