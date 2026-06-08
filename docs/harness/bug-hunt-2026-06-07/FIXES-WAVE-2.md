# Bug Hunter Fix Wave 2 — P2P / remote-control authentication

> 1 commit, 1 finding closed (the manifest-disclosure half of a Critical).
> The wave's keystone — a signed-challenge handshake (findings #1, #2, #5, and the registry half of #3) — is **deferred by design** to a dedicated session with a precise recipe in `followups-2026-06-08.md`. #4 (tombstone) and #6 (dispatch race) are deferred alongside it.
> Baseline preserved: `cargo check --features desktop,p2p` 0 errors → 0 errors.

## Why the keystone is deferred (not rushed)

Findings #1 (peer identity fully unauthenticated), #2 (mDNS trusts the advertised id), #3-registry (owned-device accepts unverified peers), and #5 (unsigned manifests) are **the same missing primitive**: a handshake that proves the remote holds the private key for the `peer_id` it claims. Today QUIC uses `SkipServerVerification` with a throwaway cert unrelated to the Ed25519 identity, and Hello/HelloAck carry `peer_id` as an unsigned string echo.

Building that handshake is a **security-protocol design task**. A subtly-wrong crypto handshake (nonce replay, accept-before-verify, wrong public-key↔peer-id binding, a `PROTOCOL_VERSION` break that bricks existing pairings) creates a *false sense of security that is worse than the documented-known gap*. It deserves careful design, crypto review, and the p2p test harness — not a rush at the tail of a 7-wave remediation run. This is the same discipline applied to the Wave-5 sync-cursor deferral, and it matters more here. The full, actionable recipe (using the existing `sign_message`/`verify_signature`/`public_key_to_peer_id` primitives) is written up in `followups-2026-06-08.md`.

## Commit

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `b236eff21` | p2p #3 (manifest half) — auth-gated resources leaked | Critical (partial) | `engine/p2p/manifest_sync.rs` |

## What was fixed

1. **Manifest never serves `requires_auth` resources.** `build_local_manifest` answered any peer's `ManifestRequest` with the complete exposed-resource list and never consulted the per-resource `requires_auth` flag — so any peer that completed the (unauthenticated) handshake learned every exposed resource, including auth-gated ones. Since peer identity isn't cryptographically verified yet, the manifest now **fails closed**: `requires_auth` resources are excluded from what's served over the wire — exactly what the flag is meant to enforce. (Once the handshake keystone lands, gate these on verified-owned peers instead of fail-closed.)

## Deferred this wave (full recipes in `followups-2026-06-08.md`)

- **p2p #1 (C)** — unauthenticated peer identity → signed-challenge handshake (the keystone).
- **p2p #2 (C)** — mDNS trusts advertised id → never derive `trusted` from the advertised id; verify via the handshake.
- **p2p #3 registry half (C)** — owned-device registry accepts unverified peers → require verified identity + store/check the peer public key.
- **p2p #5 (H)** — unsigned manifests → sign the manifest; verify against the connection's verified key.
- **p2p #4 (H)** — revoked peers resurrect → durable `revoked_peers` deny-list (migration) consulted in mDNS.
- **p2p #6 (M)** — connection insert/dispatch not atomic → spawn dispatch in the critical section.

## Verification

| Check | Result |
|---|---|
| `cargo check --features desktop,p2p` errors | 0 (baseline 0) |
| Files modified | 1 |

## Cumulative status (waves 1–7 complete; wave 2 partial)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Crypto — fail closed | 5 |
| 2 | P2P / remote-control auth | 1 (keystone deferred) |
| 3 | Trust-boundary input validation | 6 |
| 4 | Atomicity / TOCTOU | 5 |
| 5 | Data-loss (sync / dedup) | 4 |
| 6 | Panics & integrity | 5 |
| 7 | Autonomous control | 5 |

**31 of 73 findings closed** (14 Critical fully + 1 partial, 15 High, 1 Medium). Deferred set (all with recipes): p2p signed-handshake (#1/#2/#3-registry/#5), p2p tombstone (#4), p2p dispatch race (#6), execution slot-leak, sync cursor, 24h-resync, twin lost-update, execution output-interleave.

## Patterns established (catalogue items 28–29)

28. **Prove key ownership before trusting a self-asserted identity** — a `peer_id`/principal claimed over the wire or in a broadcast must be proven via a signed challenge bound to the claimed key, never accepted by string echo. Trust derived from an unproven id is spoofable end-to-end, and every downstream gate keyed on it inherits the spoof. *Grep:* a handshake that compares a remote-supplied id to an expected one without a signature check; `SkipServerVerification`/cert-verify stubs.
29. **Fail closed on auth-gated disclosure when the principal is unverified** — serve `requires_auth`/private data only to a proven principal; until verification exists, don't disclose it at all (honour the flag's intent), rather than to anyone connected. *Grep:* a `requires_auth`/`access_level`/`private` flag that exists on a record but is never consulted on the disclosure/serving path.

## What remains

The P2P security keystone (signed handshake) is the headline remaining work — a focused dedicated session per the `followups-2026-06-08.md` recipe. Beyond that: the deferred reliability items and the Medium-severity long tail per the INDEX.
