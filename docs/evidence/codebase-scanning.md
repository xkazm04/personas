---
subject: codebase-scanning
evidence:
  - src/features/plugins/dev-tools/sub_triage/findings/sweep.ts    # the canonical pipeline: gather tolerantly → emit pure → verify → dedup → cap (reported drop) → persist; skippedSensors + probedOrigins
  - src/features/plugins/dev-tools/sub_triage/findings/verify.ts   # verification as a separate pass: re-emit IS the probe; cleared only for probed sensors; moved/regressed/unchanged with a 10% noise floor; judge only shipped work
  - src-tauri/src/commands/infrastructure/standards_scan.rs        # LLM sensor contained: shipped ruleset adapted per repo, NDJSON protocol lines, vocabulary clamping, catch_unwind panic isolation, timeout-with-zero-findings = error not empty success
  - src-tauri/src/commands/infrastructure/incremental_scan.rs      # content-digest ledger: SHA256 per file, {added,modified,deleted} delta, cache_empty spelled differently from "no changes"
  - src-tauri/src/commands/infrastructure/doc_rot.rs               # sensor honesty: UNVERIFIABLE is a first-class state ("rendering it as clean was this detector's biggest lie"); bounded budget in priority order, stable truncation
  - scripts/census/rules.json                                      # declarative rule registry: baselines fail on rise AND silent drop, floor ("matcher broken, not codebase clean"), stale exemptions fail, reasons mandatory
  - scripts/census/lib/engine.mjs                                  # zero-match refusal ("a rule pinned at 0 is a gate that can never fail"), positive controls that must not carry baselines
  - scripts/analysis/orphan-modules.mjs                            # reachability over refcounts: entry-point roots, tests are not entries ("an orphan with a test"), --delete reports the transitive closure
counter_evidence:
  - scripts/check-unused-bindings.sh   # refcount-shaped dead-code guard: "referenced by app code or another binding" — the exact reference-counting blindness this subject warns about; it PROTECTS 26 of the repo's 29 orphaned generated bindings because dead consumers keep importing them (registered at #w2-ipc-contract)
deviations:
  - w6-codebase-scanning   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Codebase Scanning - evidence

How this codebase measures against the [`codebase-scanning`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
