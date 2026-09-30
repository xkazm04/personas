---
subject: metric-gates
evidence:
  - scripts/census/rules.json                       # the committed baselines: per-rule `files`/`matches` numbers living in a diffable, reviewed file rather than a dashboard
  - scripts/census/run-census.mjs                   # the ratchet itself: exit 1 on a rise AND on a silent drop; baselines change only under a deliberate --update that lands in the diff
  - package.json                                    # `census:check` / `census -- --update` — the gate and the re-baseline, kept as two separate commands on purpose
counter_evidence: []
deviations: []
---

# Metric Gates - evidence

How this codebase measures against the [`metric-gates`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
