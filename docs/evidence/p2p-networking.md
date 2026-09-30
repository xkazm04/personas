---
subject: p2p-networking
evidence:
  - src-tauri/engine/src/p2p/mdns.rs                       # minimized advertisement (id + name + version only); every TXT field validated as hostile input (32-byte id check, char-boundary name truncation, address parse + cap); batched transactional flush; stale-peer prune
  - src-tauri/engine/src/p2p/connection.rs                 # per-phase handshake timeouts, cancellation-safe dial dedupe (RAII guard), lexicographic simultaneous-connect tie-break atomic with the capacity check, typed DisconnectReason, ping/pong supervision, per-peer inbound rate limit
  - src-tauri/engine/src/p2p/mod.rs                        # one cancellation token threaded through every background loop (fresh token per restart); startup reset of stale is_connected claims; push snapshot emitter; ordered stop()
  - src-tauri/engine/src/p2p/manifest_sync.rs              # bounded manifests (entry cap), content-hash delta skip, transactional replace-not-patch, fail-closed exclusion of auth-gated resources, per-peer hash cache with a reaper
  - src-tauri/engine/src/p2p/types.rs                      # the state vocabulary (ConnectionState, trust_status doc, identity_degraded honesty flag), NetworkConfig
  - src-tauri/engine/src/p2p/transport.rs                  # dual-stack bind so neither address family is silently unreachable
  - src-tauri/core/src/models/exposure.rs                  # allowlist by construction: explicit exposure records with enumerated fields_exposed, typed access levels, requires_auth, expires_at
  - src-tauri/src/commands/network/exposure.rs             # exposure CRUD behind auth with audit-shaped logging (exposure_created/updated/deleted)
  - src-tauri/src/commands/network/discovery.rs            # IPC surface; uniform "not initialized" door; identity never masked by an empty default
  - src/features/settings/sub_network/components/NetworkDashboard.tsx  # live peer/status surface: staleness banner, identity-degraded warning, typed disconnect breakdown, push events + slow poll fallback
  - src-tauri/Cargo.toml                                   # the whole subsystem compiles behind the p2p feature tier
counter_evidence:
  - src-tauri/engine/src/p2p/connection.rs                 # ALSO the key counter-example: the header comment promises auto-reconnect, but the retry ceiling is a dead field, retry_count is never incremented, and nothing redials — absence downgrades a peer and nothing ever brings it back but a human
  - src-tauri/src/lib.rs                                   # network service auto-starts in every p2p build after a fixed delay — no discoverability consent gate; the advertisement goes out because the binary supports it, not because the user chose it
deviations:
  - w11-p2p-networking   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w11-p2p-networking   # proposed anchor for docs/concepts/golden-path-deferred-fixes.md (registered by report, not by this document)
---

# P2p Networking - evidence

How this codebase measures against the [`p2p-networking`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
