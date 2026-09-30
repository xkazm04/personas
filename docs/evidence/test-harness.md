---
subject: test-harness
evidence:
  - vitest.config.ts                          # default lane; one of 6 per-suite runner configs (.cli/.e2e/.evals/.integration + playwright)
  - vitest.integration.config.ts              # per-suite config with its own budgets: forks pool, maxForks 1, 180s timeouts
  - playwright.config.ts                      # the serial law stated in config with its reason attached (singleton companion session, workers: 1)
  - src-tauri/db/src/lib.rs                   # migrated_template(): build-once-copy-per-test, pid-keyed, stale reap, copy proved openable (89s -> 2.9s, 81aba23de)
  - scripts/build/run-rust-tests.mjs          # platform-quirk absorption: pre-main loader death (0xc0000139) fixed post-link, dead ends documented in the header
  - scripts/test/launch-isolated.mjs          # clean-environment launcher: fresh data dir, shifted ports, names its residual seam (webview storage)
  - tests/playwright/companion-bridge.ts      # typed control-surface client; fire-and-forget /eval vs awaited readback; endpoint quirks captured
  - scripts/test/chaos.mjs                    # long lane: two-phase mark/verify chaos around an operator-performed restart
counter_evidence:
  - .github/workflows/e2e-smoke.yml           # the lane that never passed: red 38 of 38 runs since inception, born broken, nobody noticed
deviations:
  - w6-test-harness   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Test Harness - evidence

How this codebase measures against the [`test-harness`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
