# Security Review: `feature/invisible-apps`

> P2P networking implementation — LAN discovery, QUIC transport, wire protocol, bundle import/export
> Reviewed: 2026-03-12

---

## Vuln 1: TLS Certificate Verification Completely Disabled — MITM on All P2P Connections

**`src-tauri/src/engine/p2p/transport.rs:142-192`**

* **Severity:** High
* **Category:** `cert_validation_bypass`
* **Description:** The `SkipServerVerification` struct unconditionally returns success for `verify_server_cert()`, `verify_tls12_signature()`, and `verify_tls13_signature()`. The server also uses `with_no_client_auth()` (line 112). This means neither side of a QUIC connection verifies the other's TLS certificate. The code comments claim "we verify peer_id in protocol" via Hello/HelloAck, but that handshake only compares an unauthenticated string — there is no cryptographic binding between the TLS session and the node's Ed25519 identity. The self-signed certificates are ephemeral (regenerated on each call to `build_tls_configs`) and unrelated to the persistent identity key.
* **Exploit Scenario:** An attacker on the same LAN performs ARP spoofing to intercept traffic between Alice and Bob. Alice opens a QUIC connection; the attacker accepts it since `SkipServerVerification` accepts any cert. The attacker opens a separate connection to Bob. The attacker relays Hello/HelloAck messages (peer_id is public via mDNS TXT records), sitting as a full MITM reading and modifying all manifest syncs, agent messages, and bundle transfers in plaintext.
* **Recommendation:** Bind the TLS transport to the Ed25519 identity. Either (a) derive TLS certificates from the Ed25519 public key and implement a custom `ServerCertVerifier` that verifies the presented cert's public key matches the expected `peer_id`, or (b) add a signed challenge-response to the Hello/HelloAck handshake requiring cryptographic proof of private key possession.

---

## Vuln 2: Identity Spoofing — No Cryptographic Proof in Handshake

**`src-tauri/src/engine/p2p/connection.rs:140-207`**

* **Severity:** High
* **Category:** `authentication_bypass`
* **Description:** The `handle_incoming()` function accepts whatever `peer_id` and `display_name` the remote peer claims in their `Hello` message with zero cryptographic verification. The `Message::Hello` and `Message::HelloAck` structs (`protocol.rs` lines 22-33) contain only `peer_id: String`, `display_name: String`, and `version: u32` — no signature, challenge, or public key fields. The Ed25519 `sign_message()` and `verify_signature()` functions in `identity.rs` are never called anywhere in the P2P connection flow. On outbound connections (`connect_to_peer`, line 108), there is a string equality check on the returned `peer_id`, but since TLS is unauthenticated (Vuln 1), the attacker controls the response. For inbound connections, there is no verification at all — any claimed `peer_id` is accepted and stored.
* **Exploit Scenario:** Attacker observes Bob's `peer_id` from mDNS TXT records (broadcast at `mdns.rs` line 43). Attacker connects to Alice's QUIC endpoint and sends `Hello { peer_id: "<Bob's ID>", display_name: "Bob", version: 1 }`. Alice accepts this, stores the connection under Bob's `peer_id`, and the attacker receives all manifest data and agent messages intended for Bob. The attacker can also send malicious `ManifestResponse` or `AgentMessage` payloads under Bob's identity.
* **Recommendation:** Add a cryptographic challenge-response to the handshake. Extend `Hello`/`HelloAck` with `public_key_b64`, `nonce`, and `signature` fields. The receiver must verify that (1) `peer_id == base58(sha256(public_key))`, (2) the signature over a session-bound payload is valid for the presented public key.

---

## Vuln 3: Bundle Import Does Not Enforce Signature Verification

**`src-tauri/src/engine/bundle.rs:310-379, 521-538`**

* **Severity:** High
* **Category:** `authentication_bypass`
* **Description:** The `apply_import()` function imports persona data from a `.persona` bundle into the local database without verifying the Ed25519 signature. It calls `parse_bundle()` (line 316) which extracts the manifest and signature, but never calls `identity::verify_signature()` before iterating over resources and writing them to the DB (line 364). The separate `preview_bundle()` function does verify the signature (line 257), but its result is only returned to the UI as an informational field — it is not enforced and does not block import. The frontend `BundleImportDialog.tsx` shows signature status but enables the Import button regardless. Additionally, `record_provenance()` hardcodes `signature_verified: true` at line 534 regardless of whether any verification occurred, creating permanently false audit records.
* **Exploit Scenario:** Attacker creates a malicious `.persona` bundle containing a persona with a crafted system prompt (e.g., prompt injection to exfiltrate data). The attacker signs it with any arbitrary key or provides an invalid signature. The victim opens the file, sees the preview (which may show "invalid signature"), but can still click Import. The data is written to the database with provenance falsely recording `signature_verified: true`. The malicious persona is now executable.
* **Recommendation:** (1) Verify the signature in `apply_import()` before any DB writes and reject bundles with invalid signatures. (2) At minimum, require the signer's public key to exist in `trusted_peers` with a non-revoked trust level. (3) Pass the actual verification result to `record_provenance()` instead of hardcoding `true`.

---

## Summary

| # | Severity | Category | File | Description |
|---|----------|----------|------|-------------|
| 1 | **HIGH** | cert_validation_bypass | `transport.rs:142-192` | TLS cert verification disabled; all QUIC connections vulnerable to MITM |
| 2 | **HIGH** | authentication_bypass | `connection.rs:140-207` | No cryptographic proof of peer identity in handshake; any LAN peer can impersonate any peer_id |
| 3 | **HIGH** | authentication_bypass | `bundle.rs:310-379, 521-538` | Bundle import never verifies signature; provenance hardcodes `signature_verified: true` |

### Architectural Note

Vulns 1 and 2 are root-cause related: the Ed25519 identity system exists and works (`identity.rs` has `sign_message` / `verify_signature`), but the cryptographic identity is never used to authenticate P2P connections. Fixing the handshake to require signed challenge-response would resolve both simultaneously.
