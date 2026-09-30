---
subject: release-pipeline
evidence:
  - .github/workflows/release.yml              # ci-gate → version → frontend → build → updater-manifest; publish is opt-in (workflow_dispatch input, default false)
  - scripts/bump-version.mjs                   # one propagation tool: package.json + tauri.conf.json + Cargo.toml + Cargo.lock in one pass; refuses unparseable versions and missing lock entries
  - scripts/generate-changelog.mjs             # commit-convention derivation; INTERNAL_RE drops chore/ci/test/style/build from user-facing notes
  - scripts/bundle-baseline.json               # committed size baseline (chunks + total) read by the delta report
  - scripts/bundle-size-report.mjs             # delta-vs-baseline markdown report for change review
  - scripts/check-bundle-budget.mjs            # the failing budget gate; shares thresholds with the report via scripts/lib/bundle-budget.mjs (single source)
  - scripts/binary-size-report.mjs             # per-target installer/binary sizes with --budget fail mode
  - src-tauri/tauri.conf.json                  # updater endpoints + shipped public key; bundle.createUpdaterArtifacts (the unbrick fix)
  - docs/development/release.md                # dispatch runbook, pre-flight checklist, post-release verification
counter_evidence:
  - CHANGELOG.md                               # second, hand-maintained changelog the pipeline never writes or cuts — two authorities, one abandoned (11 tags, 3 covered)
deviations:
  - w6-release-pipeline   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - deferred-fix-62   # tag pushed before any artifact exists (11 tags / 0 releases) — golden-path-deferred-fixes.md §62
  - deferred-fix-63   # ci-gate validates one commit, pipeline builds another — golden-path-deferred-fixes.md §63
---

# Release Pipeline - evidence

How this codebase measures against the [`release-pipeline`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
