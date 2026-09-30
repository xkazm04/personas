---
subject: device-pairing
evidence:
  - src-tauri/engine/src/pairing.rs                                      # cloud-origin ceremony: nonce-keyed pending store, approval-only mint, origin-checked single-use claim
  - src-tauri/src/commands/fleet/pairing.rs                              # device ceremony: fingerprint-only storage, constant-time verify, device cap, revocation
  - src-tauri/src/commands/fleet/companion_api.rs                        # admission scoping (LAN peer classes), fixed-delay 401, closed five-verb act grammar, per-act audit
  - src-tauri/src/commands/credentials/external_api_keys.rs              # the mint gate itself: approve_pairing mints origin-bound scoped expiring key, warms CORS allowlist
  - src/features/settings/sub_api_keys/components/PairApprovalModal.tsx  # the human gate: arm-delayed approve, scope narrowing, insecure-origin warning
counter_evidence:
  - src-tauri/src/commands/network/owned_devices.rs                      # a second writer into a trust registry that skips the ceremony — rows the reader cannot tell from ceremony rows
deviations:
  - w11-device-pairing   # anchor in docs/concepts/golden-path-deferred-fixes.md   # registered upward in the forge report; wave anchor in docs/concepts/golden-path-deferred-fixes.md to be minted by the wave lead
---

# Device Pairing - evidence

How this codebase measures against the [`device-pairing`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
