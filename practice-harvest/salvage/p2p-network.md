# Salvaged miner report — p2p/network/signing pocket (17 files, all read)
# Ground: src-tauri/engine/src/p2p/*.rs (9), src-tauri/src/commands/network/*.rs (7), src-tauri/src/commands/signing/mod.rs

## 1. Make the handshake three legs, not two, to get mutual freshness
Two-leg handshakes prove key possession but not liveness: the initiator's first signature contains nothing the responder chose, so a recorded `Hello` replays forever. Add a third leg where the initiator signs the responder's nonce, and refuse to count the connection as established until it arrives (with a timeout).
- `src-tauri/engine/src/p2p/protocol.rs:199-215` — handshake diagram; "`sig_a1` alone proves key possession but not liveness"
- `src-tauri/engine/src/p2p/protocol.rs:71-78` — `HelloConfirm` doc: "a passive observer could record one Hello and re-present it forever."
- `src-tauri/engine/src/p2p/connection.rs:631-643` — "Require the third leg before the connection counts as established," with `HelloConfirm timeout: peer did not prove liveness within 10s`.
- `src-tauri/engine/src/p2p/connection.rs:449-460` — initiator side "Close the loop: prove liveness to the responder by signing ITS nonce."
- Tests: `protocol.rs:616-623` (`a_proof_for_a_different_nonce_does_not_verify`).
evidence_count: 5

## 2. Domain-separate and injectively encode every signing transcript
Every signature is taken over `domain \n label \n peer_id \n nonce…`, with a version-bearing domain constant (`personas-p2p-handshake/v2`). Injectivity argued from the alphabets involved — no two purposes can produce a colliding transcript; a signature minted for an identity card or enclave seal can't be replayed as a handshake proof.
- `src-tauri/engine/src/p2p/protocol.rs:32-38` — `HANDSHAKE_DOMAIN` doc
- `protocol.rs:217-236` — `transcript()` + injectivity argument: "Field counts differ per label…"
- `protocol.rs:626-640` — test `transcript_labels_are_domain_separated` incl. "Nonce order is load-bearing too."
- `protocol.rs:306-345` — `PAIRING_DOMAIN` same way for fingerprint derivation.
evidence_count: 4

## 3. Verify BOTH halves of an identity claim: key→id binding and signature
Self-certifying id (peer_id = hash(pubkey)) is only safe if the presented key hashes to the claimed id AND the signature verifies under that key.
- `src-tauri/engine/src/p2p/protocol.rs:277-304` — "Both halves matter…"
- `protocol.rs:586-613` — two negative tests, one per half.
- `src-tauri/engine/src/p2p/connection.rs:441-447` and `603-609` — called on both handshake sides.
- `connection.rs:113-121` — the *proven* key stored on the connection.
evidence_count: 5

## 4. Log refused handshakes at `warn` with the concrete stage and reason
Every rejection path funnels through one helper via `.inspect_err(...)`, tagging the stage (`incoming Hello` / `incoming HelloAck` / `missing HelloConfirm` / `malformed HelloConfirm`) so a misconfigured device is distinguishable from an impersonation attempt.
- `src-tauri/engine/src/p2p/connection.rs:166-178` — `log_handshake_rejection`
- Call sites: `connection.rs:440, 447, 602, 609, 641, 648, 658-660` (7 uses).
evidence_count: 8

## 5. Treat a protocol version bump as a hard, deliberate break — and pin the version in tests
`PROTOCOL_VERSION` checked at both ends, mismatches rejected outright; new wire fields added while v2 is unshipped get a test asserting the version they're bound to.
- `src-tauri/engine/src/p2p/protocol.rs:16-24`; `connection.rs:413-418` + `576-581`; `protocol.rs:569-576` (`remote_job_frames_are_part_of_protocol_v2`); `protocol.rs:428-430`; `mdns.rs:219-223` (version in mDNS TXT).
evidence_count: 5

## 6. Assert VALUES in wire round-trip tests, because positional encoding reorders silently
MessagePack encodes enum variants positionally — a field reordered in the enum silently reinterprets the payload. Tests round-trip each frame asserting every field's value, including both shapes of an optional-bearing variant.
- `src-tauri/engine/src/p2p/protocol.rs:468-472`; `:473-567` (five frames); `:424-466` (pairing frames).
evidence_count: 3

## 7. Authenticated ≠ authorized: gate privileged message families at one chokepoint
Handshake proves who a peer is; message families with real power (remote job execution) get a second gate keyed on a local registry row (`owned_devices`), enforced in exactly one function.
- `src-tauri/engine/src/p2p/connection.rs:862-875`; `protocol.rs:119-124`; `protocol.rs:96-101` (`devices_at_stake` = "an UNAUTHENTICATED claim").
evidence_count: 3

## 8. Fail closed when serving data to peers whose identity isn't yet established
Manifest served to any connected peer omits `requires_auth` resources at the SQL level.
- `src-tauri/engine/src/p2p/manifest_sync.rs:225-240` — "fail closed until verified-peer gating exists" + `AND COALESCE(requires_auth, 0) = 0`
- `mdns.rs:156-174` — unknown peers labelled `"unverified"` not `"unknown"`; `types.rs:64-87` — two trust vocabularies, "Don't conflate."
evidence_count: 3

## 9. Read the bytes once when you hash-and-sign, or hash-and-verify
Two separate `std::fs::read` calls open a TOCTOU window (editor autosave/cloud-sync between hash and sign). Both commands derive hash + signature from one buffer.
- `src-tauri/src/commands/signing/mod.rs:80-88`; `:186-198`; `:28-35` (`hash_bytes`).
evidence_count: 3

## 10. Pin a content hash across every import path, and decide explicitly what a missing hash means
File, clipboard, and share-link imports re-hash bytes against the preview-time hash before touching the DB. Hashless deep link → REJECT (generator always emits one); pasted raw HTTP URL → warn and proceed.
- `src-tauri/src/commands/network/bundle.rs:88-110` (file), `236-262` (clipboard), `332-388` (share link), `344-351` (hashless decision), `398-401`, `453-492` (four tests, two labelled `// DECISION:`).
evidence_count: 6

## 11. Break simultaneous-connect ties deterministically, and enforce capacity under the same write lock
Lexicographically smaller peer_id is the canonical initiator; the authoritative `max_peers` check lives inside the write-lock section (read-then-write split is a TOCTOU race). Distinct QUIC close codes per reason (capacity/tie-break/rate/db).
- `src-tauri/engine/src/p2p/connection.rs:258-264`, `272-277`, `286-340`, `482-488`, `682-691`.
evidence_count: 4

## 12. Use an RAII guard (with a *sync* mutex) for in-flight-operation sets
"Currently connecting" set + Drop guard; `std::sync::Mutex` (not tokio's) so Drop can release synchronously on future cancellation; leaked entry would silently block every future connect to that peer.
- `src-tauri/engine/src/p2p/connection.rs:26-39`, `130-133`, `238-252`.
evidence_count: 3

## 13. Order side effects so a failed persist rolls back in-memory state
DB write before success metrics; on failure remove + close the in-memory connection so observers never see a phantom-connected peer disagreeing with `discovered_peers.is_connected`. Startup counterpart resets stale flags.
- `src-tauri/engine/src/p2p/connection.rs:490-500`, `693-703`; `mod.rs:86-96`.
evidence_count: 3

## 14. Treat every field from mDNS as hostile input — especially string truncation
peer_id must base58-decode to exactly 32 bytes; addresses parse as `SocketAddr` (built via `SocketAddr::new` so IPv6 gets bracketed — `format!("{}:{}")` yields unparseable `fe80::1:4242`); display names truncated on a **character** boundary (byte slice panics on multibyte and would kill the discovery task).
- `src-tauri/engine/src/p2p/mdns.rs:49-66`, `345-354`, `38-47`, `68-74`, `126-181` (single `validate_mdns_peer` chokepoint), `519-627` (11 tests incl. multibyte truncation).
evidence_count: 4

## 15. Bind dual-stack via socket2 rather than letting the platform decide
`0.0.0.0:port` rejects IPv6; `[::]:port` is IPv6-only on Windows unless `V6Only` cleared. Hand-built UDP socket with `set_only_v6(false)`.
- `src-tauri/engine/src/p2p/transport.rs:29-49`.
evidence_count: 1

## 16. Bound every peer-controlled collection, and prefer "drop new" over LRU under flood
Manifest entries (1000), inbox persona keys (drop NEW keys — LRU would let fabricated ids evict real queues), 16MB frame cap on encode AND decode, per-peer rate limits at two layers, mDNS name/address caps, clipboard byte cap.
- `src-tauri/engine/src/p2p/messaging.rs:20-27`; `manifest_sync.rs:22-24,161-174`; `protocol.rs:26-27,352-357,373-378`; `connection.rs:731-734,780-794`; `mdns.rs:22-28`; `bundle.rs:128-160`.
evidence_count: 6

## 17. Actively evict per-peer caches, or a long-running daemon leaks one entry per peer forever
Manifest hash cache `retain`ed against the connected set each sync round; rate tracker swept by periodic task honoring the shutdown token.
- `src-tauri/engine/src/p2p/manifest_sync.rs:379-388`; `messaging.rs:294-312`; `mod.rs:246-265`.
evidence_count: 3

## 18. Put a timeout on every network read, and a whole-operation timeout around multi-step exchanges
Every `protocol::decode` in request paths wrapped in `tokio::time::timeout` with reason-bearing errors; multi-step exchanges get ONE timeout around open_stream→write→read.
- `src-tauri/engine/src/p2p/manifest_sync.rs:137-146`; `connection.rs:394-402, 557-565, 632-643, 806-827, 1072-1077`.
evidence_count: 6

## 19. Batch high-frequency discovery writes behind a buffer, and flush on *every* exit path
mDNS events buffered in a map keyed by peer_id, flushed every 3s in one transaction (single fsync), AND flushed on both loop exits (cancellation + channel close). First interval tick consumed deliberately. `std::mem::take` to release lock before I/O; manual BEGIN/COMMIT/ROLLBACK. 30s TTL trusted-peer cache to avoid per-event DB queries.
- `src-tauri/engine/src/p2p/mdns.rs:301-327`, `398-461`, `76-124`.
evidence_count: 3

## 20. Surface a degraded identity instead of defaulting to a healthy-looking blank
Lost OS keyring → explicit `identity_degraded` flag (not a silent empty peer_id); dedicated `reinitialize_identity` command with the trust-invalidation consequence documented.
- `src-tauri/engine/src/p2p/types.rs:113-118`; `commands/network/discovery.rs:125-128`, `167-168`; `engine/src/p2p/mod.rs:448-449`; `commands/network/identity.rs:42-49`.
evidence_count: 4

## ANTI-PATTERNS (harvest as `pitfall` items)

### A1. Manual invalidation of a global static cache — three call sites, no compile-time enforcement
Trusted-peer cache is a file-level `static Mutex<Option<...>>` w/ 30s TTL; correctness depends on every mutation site remembering `invalidate_trusted_peer_cache()`. Three commands do; nothing prevents a fourth from forgetting (silent 30s window showing a revoked peer as trusted). Lock is `.unwrap()`ed → poisoning panics all discovery (contrast messaging.rs which recovers).
- `src-tauri/engine/src/p2p/mdns.rs:82-89, 121-124`; callers `commands/network/identity.rs:90, 119, 131`; contrast `messaging.rs:234-237`.
evidence_count: 6

### A2. Module docs promise auto-reconnect and retries that don't exist
`connection.rs` header advertises "auto-reconnect"; no reconnect path exists. `max_retries` init'd to 3 and `#[allow(dead_code)]`; `retry_count` written 0 and never incremented; health-check failure disconnects and gives up.
- `src-tauri/engine/src/p2p/connection.rs:1-4`, `135-136`, `476`, `676`; `types.rs:122-132`; `connection.rs:1057-1061`.
evidence_count: 5

### A3. Redundant advisory capacity check left beside the authoritative one
`is_at_capacity()` still called early on both paths though the doc on `try_insert_connection` explains it's racy; both paths increment the same metric; identical 40-char error string duplicated three times.
- `src-tauri/engine/src/p2p/connection.rs:199-202`, `227-236`, `537-547`, `323-335`.
evidence_count: 4

### A4. Two parallel IPC auth mechanisms in the same directory
Some commands gate with `#[requires(privileged)]` attribute macro, others call `require_auth_sync`/`require_privileged_sync` inline, one file uses both styles; macro form leaves the body with no visible gate. Third variant: async `require_auth`.
- `src-tauri/src/commands/network/bundle.rs:17-23` vs `:47-55` vs `:390-396`; `enclave.rs:12-21`; `discovery.rs:28-35`; uniform files: exposure.rs, identity.rs, owned_devices.rs, signing/mod.rs.
evidence_count: 5

## Coverage note
Files opened: 17 of 17 (all engine/p2p, all commands/network, signing/mod.rs). periodic.rs read in full — one non-excluded thin item (capped exponential backoff + recovery log, periodic.rs:82-91, 109-119). Flagged for future: mod.rs:267-314 server-pushed snapshot events replacing UI polling + emit_snapshot() after every state-changing command (discovery.rs:56-57, 69-70).
