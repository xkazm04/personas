---
layer: application
subject: device-pairing
technique: timing-defenses
stack: rust
---

# Constant time + fixed delay on the companion auth path

The device-token verification path implements both layers of the
technique, in the order the technique prescribes.

## Constant-time comparison over fingerprints

`ct_eq` (`src-tauri/src/commands/fleet/pairing.rs:108-117`) is the
XOR-accumulate loop — "never early-exits on a mismatch, so timing does
not leak how many leading bytes of a presented credential matched"
(`:106-107`). Crucially it compares **SHA-256 fingerprints**, not raw
tokens (`verify_token`, `:124-134`): the presented token is hashed first
(`token_fingerprint`, `:97-104`), so the compared length is fixed and
public and the length-mismatch early return at `:109-111` leaks nothing.
`verify_token` also iterates **every** stored device rather than
returning on first match (`:126-133`, with the comment weighing exactly
this trade), removing registry position from the signal. Unit tests pin
both the equality behavior (`:358-364`) and the
revoked-token-never-authenticates rule (`:387-394`).

## The fixed-delay 401

`authorize` (`companion_api.rs:223-248`) orders the gates cheap-to-
expensive: LAN peer class (free refusal) → missing token (401, no
delay needed — nothing was guessed) → fingerprint match. Only the
**failed-guess** path sleeps: `AUTH_FAIL_DELAY_MS = 350` (`:56-58`),
applied before the 401 leaves — "makes online brute force glacial
without a lockout table" — and it is an async sleep, so a probing client
burns its own wall-clock, not a server thread. Success answers at
natural speed; the legitimate phone never pays.

## Refusal vocabulary, and where the distinctions live

The API error shape is uniform (`{ok: false, code}`, `:215-219`), with
coarse codes (`lan_only`, `missing_token`, `bad_token`) — enough for the
PWA's self-heal (drop the stored token on 401) without describing the
registry. The true causes land server-side: every act writes a
`fleet_decisions` ledger row, success or failure, with the device id
(`:480-502`).

## The gap, stated

The cloud-claim surface (`engine/src/pairing.rs:308-330`) does **not**
apply a fixed delay, and its refusal vocabulary is deliberately richer
(404 unknown/expired vs 403 rejected vs 403 origin-mismatch vs 410
claimed). The claim's protection is the nonce's 16-char entropy floor and
the 300-second window — a guessing budget argument rather than a
throttling one — but `OriginMismatch` as a distinct code does confirm to
a probing caller that a nonce is approved-and-unclaimed, which is more
than the uniform-shape rule would give away. Sibling comparisons in the
same tree that lack even the constant-time layer (a `==` on a session
token in the browser bridge, a `HashMap::get` keyed by a session header
— measured in `docs/concepts/golden-paths/cross-device-pairing.md` §0.1)
mark where the technique has not yet traveled.
