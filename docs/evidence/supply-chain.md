---
subject: supply-chain
evidence:
  - scripts/secret-scan.mjs                          # staged-diff scan at commit; the announced skip when the engine is absent (honest output, zero enforcement)
  - src-tauri/deny.toml                              # the four policy clauses as committed config: advisories deny, license allowlist (never denylist), unknown sources deny, wildcard bans
  - renovate.json                                    # tiered update automation: patch/pin/digest automerge only behind green gates; minor/major and all native-side bumps open reviewed PRs
  - .github/workflows/audit.yml                      # the scheduled deep lane: weekly full dependency + security audit off the commit path
  - .github/workflows/codeql.yml                     # deep static analysis at review AND weekly — its own comment names the reason: "catches new advisories on unchanged code"
  - scripts/check-csp-hosts.mjs                      # manifest-vs-use verifier: every frontend fetch host must appear in both content-security allowlists; asserts nonzero populations on both sides (exit 2)
  - src-tauri/capabilities/default.json              # scoped permission manifest: named windows, enumerated permissions, no wildcards
  - src-tauri/src/companion/tts/sherpa_engine.rs     # extract_selected: tar-slip containment (refuses the whole archive) + sentinel assertion (empty extraction is an error, not success)
  - src-tauri/engine/src/path_safety.rs              # sensitive-credential-path denylist gating watch/read targets (~/.ssh, cloud credential files), mirrored across the language boundary
counter_evidence:
  - docs/concepts/golden-paths/secret-leak-scanning.md   # the control that never executed: engine absent on the dev machine, the skip fired 3,186 times, zero scan jobs in any of 7 pipeline workflows — and the allowlist pre-loaded to fire on the repo's own test idiom
  - docs/concepts/golden-paths/supply-chain-policy.md    # the policy that never rendered a verdict: 350 runs, 0 verdicts (skipped behind failing steps, then dead on a schema drift — engine floats, policy frozen); update automation configured 67+ days, never enabled; 56 pipeline-step refs, 0 SHA-pinned
deviations:
  - w11-supply-chain   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w6-quality-gates
---

# Supply Chain - evidence

How this codebase measures against the [`supply-chain`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
