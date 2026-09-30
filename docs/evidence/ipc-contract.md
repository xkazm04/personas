---
subject: ipc-contract
evidence:
  - src/lib/tauriInvoke.ts                    # the single wrapper: timeout ladder, at-least-once hazard documented at the point of failure, idempotency + auto-dedup, raw-primitive ban target
  - src/lib/utils/tauri/safeInvoke.ts         # anchored "command not registered" detection, with the substring-match incident recorded in its own header
  - scripts/check-command-contract.mjs        # declared/registered/invoked set parity + parameter-name parity, four assertions
  - .github/workflows/ci.yml                  # binding-drift job: generate-then-diff with the untracked-file blind spot closed and its regeneration flags documented inline
  - src-tauri/build.rs                        # generation output root declared once, via the route that reliably reaches the generator
counter_evidence:
  - src/api/companion.ts                      # the forked contract: a hand-written mirror of a generated type, patching a value-fidelity defect at the wrong layer
deviations:
  - w2-ipc-contract   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Ipc Contract - evidence

How this codebase measures against the [`ipc-contract`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
