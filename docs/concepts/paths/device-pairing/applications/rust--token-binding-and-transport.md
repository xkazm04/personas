---
layer: application
subject: device-pairing
technique: token-binding-and-transport
stack: rust
---

# Two token lifecycles, both born bound

The repo runs the technique twice with different transports: the
cloud-origin key delivered by single-use claim
(`src-tauri/engine/src/pairing.rs`) and the companion device token
delivered by fragment QR (`src-tauri/src/commands/fleet/pairing.rs`).

## The claim channel (cloud origin)

The module docstring states the doctrine outright: the cloud app polls
`GET /pair/claim?nonce=…` to retrieve the token exactly once — "never via
the deep-link query string (deep links leak to OS logs)"
(`engine/src/pairing.rs:13-15`). The deep link carries nonce and request
metadata only; the credential travels nowhere until claimed.

`claim` (`:198-223`) enforces the full ranking:

- **origin-checked delivery**: the claimant's `Origin` header must equal
  the approved origin, else `OriginMismatch` → 403 with no token leaked
  (`:216-218`, pinned by the test at `:373-377`) — "defense in depth —
  the token is origin-bound anyway" (`:214-215`);
- **single-use**: the `claimed` flag flips on delivery; a second claim is
  `Gone` → HTTP 410 (`:210-212`, `:326`) — a *distinguishable* answer, the
  legitimate holder's theft alarm;
- **coarse requester vocabulary**: pending → 202, rejected → 403,
  expired/unknown → 404 (`:320-328`) — exactly the states the requester's
  poll loop needs, no more.

The binding itself persists as `external_api_keys.bound_origin`
(`external_api_keys.rs:167-174` passes `Some(origin)` at mint), which the
management API checks per request and the CORS allowlist re-derives from
on revoke.

## The fragment QR (companion device)

`fleet_pair_device` (`fleet/pairing.rs:252-304`) mints 32 bytes of OS
randomness (`:264-270`) and builds
`http://<lan-ip>:<port>/m/#t=<token>` (`:292`) — the token rides the URL
**fragment**, which "never appears in HTTP request lines or server logs"
(`FleetPairResult` docs, `:215-217`; same rule restated at
`companion_api.rs:31-33`). The QR is rendered backend-side as SVG path
modules (`qr_svg`, `:158-181`), and the test asserts the plaintext does
not appear as text inside the markup (`:409-416`).

**Fingerprint-only storage**: `PairedDevice` persists `token_sha256` and
metadata, "never a secret" (`:48-61`); `token_fingerprint` (`:97-104`) is
the one-way step; and the round-trip test asserts the serialized store
contains the fingerprint but not the token (`:397-406`) — the exact
"serialize the registry and grep for the plaintext" invariant the
technique prescribes. The plaintext is returned exactly once in the
pairing result ("the only copy that will ever exist on this desktop",
`:249-251`) and the settings listing DTO carries neither token nor
fingerprint (`FleetCompanionDevice`, `:221-231`; "Never returns
fingerprints", `:306`).

## Where the sibling ceremony breaks the substance rule

The counter-example is `device_group_id` in the P2P pairing arc: one
string is simultaneously a shared *identifier* (stored plaintext on every
device row, returned by a public-tier command, serialized to the client)
and the HKDF *seed* for an AES-256-GCM snapshot key
(`src-tauri/engine/src/workspace_sync/crypto.rs:43`) — and it is sent in
the opening `PairRequest` frame **before** the human confirms the code.
Latent today only because the derive function has zero callers; the full
measurement lives in `docs/concepts/golden-path-deferred-fixes.md` §36.
It is the technique's P9 rule violated at birth: key material doubling as
an identifier, disclosed pre-approval.
