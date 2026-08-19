---
layer: application
subject: device-pairing
technique: revocation-and-expiry
stack: rust
---

# Revocation reach, measured across three trust registries

The repo demonstrates the technique's full ladder — and its two-tier
honesty rule — because its three pairing registries reach differently.

## Expiry at every layer (cloud-origin path)

Pending pairings live 300 seconds, pruned on every store access
(`engine/src/pairing.rs:38`, `:77-80`); the unclaimed plaintext stash
dies with its pending record's TTL; and the minted key's expiry is
stamped server-side from the modal's 7/30/90-day choice — "we stamp the
absolute timestamp here rather than trust the client clock"
(`external_api_keys.rs:27-31`, `:164-165`). No layer offers "forever" as
the default.

## Revocation reaching the door — the good case

The companion device path re-reads the trust registry **per request**:
`authorize` calls `pairing::load_devices(&state.db)` on every call
(`companion_api.rs:237`), so `fleet_companion_revoke` — a revoked flag,
not a row deletion (`fleet/pairing.rs:332-346`) — is "effective on the
device's next request" by construction. The flag-not-delete choice keeps
the device visible in the settings list as revoked and preserves the
ledger's referent. The remote client self-heals: the PWA drops its token
from local storage on any 401 (`resources/mobile/app.js:312-316`), so a
revoked phone stops retrying within one poll cycle. Liveness metadata
exists for the reap-review loop: `touch_device` stamps last-seen,
throttled to once a minute (`fleet/pairing.rs:138-151`), and the
settings DTO surfaces it (`:221-231`).

The cap: `MAX_DEVICES = 8`, refused loudly at the ceremony — "Keeps the
credential surface enumerable by a human" (`:40-42`, enforced
`:257-261`).

## Revocation reaching the allowlist — the re-derive case

`revoke_pairing` (`external_api_keys.rs:217-231`) revokes the key and
then **re-derives** the CORS allowlist from the database
(`load_paired_origins`) rather than removing one origin from the
in-memory set — convergence on the registry, correct even when two live
keys share an origin.

## Revocation not reaching the work — the measured miss

The P2P path is the technique's negative case, measured in
`docs/concepts/golden-paths/cross-device-pairing.md` §0.5:
`forget_owned_device` is a bare DELETE; `disconnect_peer` exists one
file away and is not called from the unpair path; a running inbound job
continues under a 27-minute ceiling; and the mDNS trust check sits
behind a 30-second process-global cache whose invalidation hook has no
caller on the revoke path. Every one of these is an asset a revoked peer
holds *across* requests — connection, task, cache entry — with no closer
wired to revocation. The row deletion also destroys the history a
revoked-flag would have kept. Same repo, same week, opposite reach: the
difference is not skill but whether the revocation path was designed
against the asset list or against the registry row alone.
