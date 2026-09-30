---
subject: eval-harness
evidence:
  - src-tauri/engine/src/test_runner/       # the canonical manifestation: deliberately-scoped scenario cache key (excludes prompt text — UAT 2026-07-20 exam-drift incident at :57-74), LAB_CELL_CONCURRENCY=4 fan-out semaphore, pinned LAB_MODEL, never-cache-empty guard (:412-415), one run_lab_loop behind arena/A-B/eval/matrix/consensus modes
  - src-tauri/engine/src/output_assertions.rs # the deterministic band (contains/regex/json-path/json-schema) + evaluate_assertions_dry: challenger scoring writes no evidence rows
  - src/features/agents/sub_lab/libs/evalAggregation.ts # version×model grid, null scores excluded from averages, composite formula pinned by a golden test, declared winner = top of pre-declared sort
  - src/stores/slices/agents/labSlice.ts      # LabMode = arena|ab|matrix|eval|versions|breed|evolve|regression; per-mode run lifecycles
  - src-tauri/db/src/quality_gate.rs          # deterministic content gate (reject/tag/warn) over model submissions, config not code
  - evals/README.md                           # the golden-set tier: deterministic contract evals over agent specs/prompt builders, wired pre-push
  - vitest.evals.config.ts                    # the cheap tier runs inside the deterministic lane's own runner
  - scripts/test/judge-packet.mjs             # per-run judge packet: everything the judge reads, assembled reproducibly into one artifact
  - scripts/test/athena-model-bench.mjs       # model×effort matrix cells, reps per cell, deterministic validator first — LLM judge deliberately deferred
  - uat/README.md                             # L1 theoretical (code-derived surface) gating L2 empirical (live harness); "verification vs evaluation" stated at the top
  - docs/development/model-effort-guide.md    # judge disagreement ρ=0.50, own-family-first bias, effort inversion on design work, the descoped arm
counter_evidence: []
deviations:
  - w8-eval-harness   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Eval Harness - evidence

How this codebase measures against the [`eval-harness`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
