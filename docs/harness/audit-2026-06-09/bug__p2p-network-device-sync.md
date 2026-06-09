# Bug Hunter — p2p-network-device-sync
> Total: 6
> Severity: 1 critical, 4 high, 1 medium

## 1. Peer identity is self-declared and never cryptographically proven — full trust spoofing
- **Severity**: critical
- **Category**: network-trust
- **File**: src-tauri/src/engine/p2p/connection.rs:471-490 (incoming Hello), 350-377 (outgoing HelloAck); src-tauri/src/engine/p2p/transport.rs:171-205 (SkipServerVerification); src-tauri/src/engine/p2p/mdns.rs:88-104,161-165 (is_trusted_peer)
- **Scenario**: Attacker on the LAN reads a victim's `peer_id` (it is broadcast in plaintext in the mDNS TXT record, `mdns.rs:219-223`). The attacker advertises/connects and in the `Hello`/`HelloAck` simply sets `peer_id` to a *trusted* peer's id. `handle_incoming` accepts the value verbatim (`connection.rs:471-490`): it only checks `version` and `remote_peer_id != self.local_peer_id`. The QUIC layer presents a self-signed cert that `SkipServerVerification` (transport.rs:176-186) accepts unconditionally, so the cert is not bound to the identity either. The accepted `peer_id` is then the key used by `is_trusted_peer` (mdns.rs:161) and by every downstream trust/owned-device decision.
- **Root cause**: The protocol derives identity from an *unauthenticated, self-asserted* field. `public_key_to_peer_id` proves `peer_id = base58(sha256(pubkey))`, but the peer never signs a challenge proving it holds the matching private key. The code comments admit this ("identity not yet proven via handshake", `mdns.rs:170`; "p2p signed handshake" followup, `manifest_sync.rs:227-232`) yet the connection is still established and acted upon.
- **Impact**: security — impersonation of any trusted peer / owned device; foundation for findings #2 and #5. Trust UI shows "trusted" for an attacker.
- **Fix sketch**: Make trust impossible without proof of key possession. Include the Ed25519 `public_key` in `Hello`/`HelloAck`, require a signed nonce challenge in the handshake (`identity::verify_signature` already exists), reject if `peer_id != base58(sha256(public_key))` or the signature fails, and bind the QUIC cert's SPKI/SAN to the identity instead of `SkipServerVerification`. Until then, never map an unproven peer to `trust_status="trusted"`.

## 2. Exposure manifest is served to any connected (unauthenticated) peer
- **Severity**: high
- **Category**: network-trust
- **File**: src-tauri/src/engine/p2p/connection.rs:680-683 (ManifestRequest handler); src-tauri/src/engine/p2p/manifest_sync.rs:233-257 (build_local_manifest)
- **Scenario**: Any peer that completes the (spoofable, see #1) handshake opens a stream and sends `ManifestRequest`. `dispatch_inbound_message` calls `build_local_manifest()` and returns every non-expired exposed resource where `requires_auth = 0` — with no check that the requesting peer is trusted or an owned device.
- **Root cause**: The only access gate is the per-resource `requires_auth` boolean (manifest_sync.rs:238-239). Resources the user exposed at access_level read/execute/fork but left `requires_auth=false` (the default in `CreateExposedResourceInput`) are disclosed to the entire LAN, including resource ids, display names, and capability tags an attacker can use for targeted follow-up requests. The manifest is broadcast-grade data handed to an unauthenticated counterparty.
- **Impact**: security — information disclosure of the exposed-resource inventory to any LAN peer; provenance/leak surface wider than the user intends.
- **Fix sketch**: Gate `build_local_manifest` on verified peer identity: pass the (proven) `peer_id` into the handler and only return entries when the peer is in `trusted_peers` (non-revoked) or `owned_devices`, scoping access_level by trust tier. Make `requires_auth` default to true. Fail closed for unproven peers.

## 3. Tombstone resurrection via clock-skew last-writer-wins
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/engine/workspace_sync/merge.rs:140-169 (last_writer_wins / compare_rfc3339), 107-134 (merge_entity)
- **Scenario**: Device A deletes a persona at its real local time T (tombstone `deleted_at=T`). Device B has a fast/wrong clock and earlier made a live edit stamped `updated_at=T+1h` (a future-dated `updated_at`, common with clock skew or a manual time change). Both moved off base, so merge takes the `(true,true)` branch and resolves by `last_writer_wins`: B's live edit has the later timestamp, so the live entity beats the tombstone and the deleted persona is restored on both devices.
- **Root cause**: Conflict resolution orders deletes vs. edits purely by wall-clock `modified_at`. There is no logical clock / version vector and no "delete dominates a concurrent edit" rule, so a single skewed clock silently reverses the user's delete intent. `compare_rfc3339` falls back to byte comparison on unparseable input, which can also order timestamps nonsensically.
- **Impact**: data loss inverse — deleted personas/memories/triggers resurrect and re-sync to every owned device; user cannot reliably delete.
- **Fix sketch**: Replace wall-clock LWW with a monotonic per-device counter / version vector (Lamport or HLC) carried in snapshots; on a tie or unparseable timestamp, prefer the tombstone (deletes win over concurrent edits) and never trust a remote timestamp that is far in the future. Keep tombstones until all known owned devices have acknowledged them rather than relying on timestamps alone.

## 4. `register_owned_device` trusts a caller-supplied peer_id with no identity proof
- **Severity**: high
- **Category**: network-trust
- **File**: src-tauri/src/commands/network/owned_devices.rs:32-54; src-tauri/src/db/repos/resources/owned_devices.rs:74-95
- **Scenario**: `register_owned_device(peer_id, device_group_id, display_name)` writes the row after only checking `peer_id != local`. Because the workspace-sync loop "exchanges snapshots only with peers in this registry" (owned_device.rs:8-10) and owned-device sync auto-resolves conflicts by LWW with *no manual review* (merge.rs:6-9), a peer_id placed here is granted write access to the user's persona workspace. Combined with #1, an attacker who learns/guesses the out-of-band `device_group_id` (or a buggy/automated pairing path) can register an attacker peer_id as an "owned device" and then push tombstones/overwrites that win via LWW.
- **Root cause**: The registry — the highest-privilege trust primitive in this subsystem — is a "thin wrapper over the ungated repo" (file header) with no verification that the peer_id corresponds to a key the user actually paired with, and no proof-of-possession at sync time. The `ON CONFLICT DO UPDATE` lets any later call silently move an existing device into a different `device_group_id`.
- **Impact**: security / data corruption — an unverified peer gains workspace write/delete authority over the user's personas.
- **Fix sketch**: Require the pairing flow to capture and store the peer's public key; verify a signed challenge before insert; bind sync acceptance to a proven identity (finding #1). Reject `device_group_id` changes on an existing peer_id unless explicitly re-paired.

## 5. mDNS discovery flooding: unbounded `discovered_peers` growth from spoofed peer_ids
- **Severity**: medium
- **Category**: DoS
- **File**: src-tauri/src/engine/p2p/mdns.rs:331-389 (buffer_mdns_event), 399-461 (flush), 464-479 (prune_stale_peers)
- **Scenario**: A malicious LAN host emits mDNS announcements cycling through thousands of *valid-format* random peer_ids (any base58 string decoding to 32 bytes passes `validate_peer_id`). Each distinct id upserts a new row in `discovered_peers`; the batch flush has no cap on distinct peers per window. `prune_stale_peers` only removes rows older than 120s AND `is_connected=0`, so within each window the table can balloon, and every `get_discovered_peers` / snapshot read (mdns.rs:482-512, called on a 15s timer for the UI) scans the whole table.
- **Root cause**: Validation proves *format* but there is no rate limit / cardinality cap on how many distinct unverified peers a single source (or the whole LAN) may register, and no per-source throttle. A peer_id costs the attacker nothing to mint.
- **Impact**: DoS / UX degradation — DB bloat, slow snapshot polls, unusable peer list; sustained disk writes.
- **Fix sketch**: Cap total `unverified` discovered peers (LRU-evict by `last_seen_at`), rate-limit inserts per source IP, and prune unverified peers far more aggressively than trusted ones. Prefer surfacing only trusted/owned peers by default in the UI.

## 6. Inbound stream rate limit resets its window without disconnecting, allowing sustained flood
- **Severity**: medium
- **Category**: DoS
- **File**: src-tauri/src/engine/p2p/connection.rs:602-616 (per-peer rate limiting in spawn_inbound_dispatch)
- **Scenario**: The per-peer limit is 100 messages / 10s, but the window is checked *lazily at stream-accept time*: `if rate_window_start.elapsed() > WINDOW { reset }` then `rate_msg_count += 1`. A peer that opens streams at exactly the window cadence keeps `rate_msg_count` low while still forcing one `tokio::spawn` + 10s-timeout decode task per stream. Each accepted stream spawns an independent task (connection.rs:622-663) that holds a buffered reader for up to 10s; nothing caps *concurrent* in-flight stream tasks per peer, only the rolling count. A peer can therefore keep hundreds of decode tasks alive simultaneously without ever tripping the counter.
- **Root cause**: The limiter bounds messages-per-window but not concurrent resource consumption (spawned tasks / open streams / buffered memory). The reset is a hard zeroing rather than a token bucket, so bursts that straddle a window boundary (e.g. 99 just before reset + 99 just after) pass at ~2x the intended rate.
- **Impact**: DoS — memory/task exhaustion from a single connected (spoofable) peer; amplified by #1 since the peer need not be trusted.
- **Fix sketch**: Use a token-bucket limiter (no hard window reset), bound the number of concurrently spawned per-peer stream tasks with a semaphore, and shrink the per-stream decode timeout. Disconnect (not just skip) peers that exceed the concurrency cap.
