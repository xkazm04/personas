---
subject: concurrent-vcs
evidence:
  - .claude/CLAUDE.md                                            # "Concurrent CLI sessions" + "Parallel-safety primitives": the incidents (2026-05-09 stash sweep, 2026-08-13 index contention) and the 2026-08-18 read-tree seeding correction
  - .claude/active-runs.md                                       # the intent ledger itself, with its recorded incidents
  - docs/concepts/golden-paths/parallel-session-coordination.md  # the fault-injection study: Q1-Q6 in a hook-free throwaway repo, ten deviations, the push-race field incident
  - .claude/mvp/calibration.md                      # the isolated-index technique discovered independently and held across four runs x eight concurrent builders
  - scripts/worktree-gc.mjs                                      # worktree GC: clean AND merged AND stale before removal; orphan dirs are a lower-trust class
  - scripts/build/guard-concurrent-cargo.mjs                     # shared-resource arbitration by live-process inspection, not lock files; fail-open loudly
counter_evidence: []
deviations:
  - w6-concurrent-vcs   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Concurrent Vcs - evidence

How this codebase measures against the [`concurrent-vcs`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
