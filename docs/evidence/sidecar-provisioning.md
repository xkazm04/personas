---
subject: sidecar-provisioning
evidence:
  - src-tauri/src/companion/stt/downloader.rs      # curated catalog validated at every door, pinned host, partial staging + atomic rename, per-model inflight guard, throttled progress (time+byte floors), truncation check vs advertised length, partial cleanup scoped to one artifact
  - src-tauri/src/companion/tts/kokoro.rs          # full three-rung ladder (env override → managed engine dir → system path); out-of-process sidecar chosen explicitly to dodge an in-process native-runtime version collision
  - src-tauri/src/companion/tts/pocket.rs          # long-lived local HTTP sidecar service (keeps model warm), env URL override, dual-backend routing with degrade
  - src-tauri/src/companion/tts/kokoro_installer.rs # one-click provision: download + selective extract into managed dirs, install-scoped inflight guard, half-extracted-tree cleanup
  - src-tauri/src/webbuild/bun.rs                  # env override → system path resolution for a never-provisioned tool sidecar; actionable not-found error naming both remedies
  - scripts/ensure-ort-cache.mjs                   # content-sniff of declared machine type defeating a mislabeled upstream artifact (packaging's ground; cited as the sniff precedent)
counter_evidence:
deviations:
  - w10-sidecar-provisioning   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Sidecar Provisioning - evidence

How this codebase measures against the [`sidecar-provisioning`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
