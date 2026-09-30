---
subject: signed-artifacts
evidence:
  - src-tauri/src/engine/bundle.rs                 # verify_against_trusted_key — the strongest verification door: stored key, revocation checked, two-boolean verdict
  - src-tauri/engine/src/enclave.rs                # raw-signed-bytes verification + id↔key binding, with both post-mortems in comments
  - src-tauri/src/commands/signing/mod.rs          # read-once hashing (TOCTOU closed twice), all-or-nothing sign, sidecar build/export
  - src-tauri/src/commands/network/bundle.rs       # preview→commit hash pinning on every ingress channel; the hashless share-link decision, tested
  - src/features/settings/sub_network/components/BundleImportDialog.tsx   # danger-kind-matched consent that re-arms when the danger context changes
  - src/features/plugins/drive/signing/useSigning.ts                      # absolute↔relative path normalization so records match files across spellings
counter_evidence:
  - src/features/plugins/drive/signing/DriveVerifyDialog.tsx   # a two-state verdict card that renders an envelope-supplied name under a green check
deviations:
  - w11-signed-artifacts   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - deferred-fix-76   # entry "## 76." in docs/concepts/golden-path-deferred-fixes.md — verify_document verifies against the key inside the file it checks
  - deferred-fix-77   # entry "## 77." — the sensitive-path denylists miss the platform spelling they name, and guard the wrong door
  - deferred-fix-78   # entry "## 78." — the signing surface is absent from the default dev build and the UI does not know
---

# Signed Artifacts - evidence

How this codebase measures against the [`signed-artifacts`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
