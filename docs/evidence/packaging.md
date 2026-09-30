---
subject: packaging
evidence:
  - .github/workflows/installer-test.yml         # per-cell acceptance: x64+arm64 release-artifact install test (fail-fast off), macOS structural checks, Linux deb/AppImage install+launch smokes
  - scripts/test-installer.ps1                   # the ladder on the installed tree: silent install → file/size/payload/registry verification → health-check launch → silent uninstall
  - scripts/verify-onnxruntime-bundling.mjs      # linking-aware native-payload gate: reads the exe's import table (ground truth of what was linked) instead of assuming a fixed mode
  - scripts/ensure-ort-cache.mjs                 # the mislabeled-arch tarball fix: sniffs the cached lib's REAL machine type, swaps in a digest-verified official build; sentinel-idempotent
  - scripts/build/inspect-pe-imports.mjs         # binary-anatomy instrument: import table + embedded manifest, settled a months-old loader failure two written root causes had missed
  - scripts/check-tauri-configs.mjs              # variant drift gate: canonical + overlays, key allowlist ("Expand intentionally"), parse failure is loud, CSP check fails-not-skips
  - src-tauri/tauri.conf.json                    # the base configuration; lite/stable variants overlay only build.features + bundle.targets
  - src-tauri/nsis/languages/Czech.nsh           # installer customization as versioned code: hand-written installer locale files, reviewed like source
counter_evidence:
  - src-tauri/tauri.android.conf.json            # the variant OUTSIDE the drift gate: forks identity and security policy instead of overlaying, and no gate reads it
deviations:
  - w6-packaging   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Packaging - evidence

How this codebase measures against the [`packaging`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
