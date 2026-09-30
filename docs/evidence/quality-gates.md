---
subject: quality-gates
evidence:
  - lefthook.yml                                    # the two local rungs, with the ladder + hygiene rationale written into the file itself (fast pre-commit, hooks never mutate the tree, heavy checks on pre-push, CI backstop)
  - package.json                                    # `check` — the 9-step && merge-rung chain; `census:check` / `census -- --update` — the ratchet pair
  - scripts/census/run-census.mjs                   # the ratchet: exit 1 on a rise AND on a silent drop; baselines updated only by a deliberate --update that lands in the diff
  - scripts/census/check-corpus-integrity.mjs       # living liveness exemplar: FATAL (exit 2) vocabulary distinct from fail, instrument asserted before result, ROOT derived from file location after the one-laptop incident
  - scripts/secret-scan.mjs                         # the announced skip: scanner absent → loud hint + exit 0 — honest output, zero enforcement without a binding backstop
  - .github/workflows/ci.yml                        # the binding rung: conventional-commit lint with engineered exemptions, binding-drift and command-name-drift gates
counter_evidence:
  - docs/concepts/golden-paths/adding-a-ci-gate.md  # measured: the binding rung had NEVER passed — 0 successes in 260 runs — while merging continued; a permanently red backstop is no gate
  - docs/concepts/golden-paths/commit-path-gates.md # fault-injection: the quiet flag disarms the display channel, not the exit code — a mechanism folklore five documents repeated wrongly; and the only pre-commit job firing on every commit was one that cannot fail
deviations:
  - w6-quality-gates   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Quality Gates - evidence

How this codebase measures against the [`quality-gates`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
