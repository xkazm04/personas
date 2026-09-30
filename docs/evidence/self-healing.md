---
subject: self-healing
evidence:
  - src-tauri/engine/src/healing_orchestrator.rs      # the decision tree: documented precedence + mutual exclusion in the module doc, pure evaluate(), AI healing dev-gated, storm cap with distinguishable diagnosis
  - src-tauri/engine/src/failure_signature.rs         # signature normalization (uuid/hex/number/whitespace → tokens, length-capped) + recurrence breaker
  - src-tauri/db/src/repos/execution/healing.rs       # confirmed-vs-reverted effectiveness ledger per category; pending-state machine with a deterministic TTL reaper
  - src-tauri/src/engine/auto_rollback.rs             # aggregate error-rate regression rollback: volume floors on BOTH sides, target-health gate, atomic transactional undo, loud (UI event + persisted audit event)
  - src-tauri/db/src/audit_incidents_promoter.rs      # per-source incident promotion, idempotent re-promote, healing misses only — routine successes never surface
  - src/stores/toastStore.ts                          # the dedicated 'healing' toast class: severity-ranked priority, dedupe by issue id, priority-respecting eviction
counter_evidence:
  - src-tauri/db/src/repos/execution/healing.rs       # same ledger, the gap: no unknown lane — attempted = confirmed + reverted, so TTL-expired pendings vanish from the denominator instead of being reported as unmeasured
deviations:
  - w8-self-healing   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-error-handling   # 40/43 Unknown healing issues collapse to one normalized string — the diagnosis layer gone blind upstream (registered under error-handling; cited, not re-registered)
---

# Self Healing - evidence

How this codebase measures against the [`self-healing`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
