---
subject: build-economics
evidence:
  - src-tauri/Cargo.toml                          # workspace split members + feature tiers (desktop/desktop-full/ml/p2p) + per-profile debuginfo dials ([profile.test] debug=0, dev line-tables-only)
  - scripts/build/sample-build-memory.ps1         # peak-RSS sampler; header records the 8.9 GB → 6.2 GB split win and the honest one-variable comparison
  - scripts/build/crate-split-deps.mjs            # dependency-graph closure probe that planned the crate split
  - scripts/cache-budget.mjs                      # byte-budgeted target-dir cache with prune order + hard-ceiling self-healing backstop
  - scripts/check-build-cache.mjs                 # toolchain host-triple drift detector (stale-rlib contamination)
  - scripts/ensure-ort-cache.mjs                  # cached native artifact verified by machine-type inspection, not label
  - scripts/build/guard-concurrent-cargo.mjs      # refuses a second concurrent heavy build on one checkout
  - .claude/CLAUDE.md                             # the lite-vs-full dev-variant routing table ("Picking dev variants")
counter_evidence:
  - docs/development/build.md                     # the cleaning ladder + build claims documented in parallel with the entry-point docs — the multi-copy drift the one-authority posture warns about
deviations:
  - w6-build-economics   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Build Economics - evidence

How this codebase measures against the [`build-economics`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
