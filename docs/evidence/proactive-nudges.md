---
subject: proactive-nudges
evidence:
  - src-tauri/src/companion/proactive/mod.rs              # notice/delivery decoupling: cheap unconditional enqueue, dedupe on (trigger_kind, trigger_ref), lifecycle sweep with per-lane expiry, one release path claiming queued→delivered
  - src-tauri/src/companion/proactive/budget.rs           # global daily ceiling + per-kind caps, claimed atomically in one transaction; engagement-modulated (±1, sample floor, clamped ≥1)
  - src-tauri/src/companion/proactive/quiet.rs            # quiet/focus windows: inclusive-from/exclusive-to, midnight wrap, degenerate-window and empty-days semantics pinned by property tests
  - src-tauri/src/companion/proactive/triggers.rs         # pure trigger evaluators — no persistence, no side effects; cadence firing-window contract pinned by property tests
  - src-tauri/src/companion/proactive/incident_triggers.rs # incident nudge: evaluator over open high/critical incidents, trigger_ref anchored on most-severe id for dedupe + deep-link
  - src-tauri/src/notifications.rs                        # per-event delivery preferences — the per-kind opt-out matrix at the delivery tier
counter_evidence:
  - src-tauri/src/companion/night_shift/mod.rs            # enqueue_external + deliver_now side door: direct delivery that skips the budget claim; quiet re-checked only at some call sites, bypass uncounted — the per-kind side channel the decoupling technique forbids
deviations:
  - w10-proactive-nudges   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Proactive Nudges - evidence

How this codebase measures against the [`proactive-nudges`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
