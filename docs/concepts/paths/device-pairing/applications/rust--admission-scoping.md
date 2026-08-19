---
layer: application
subject: device-pairing
technique: admission-scoping
stack: rust
---

# Admission scoping across the three listeners

The repo splits its pairing-adjacent surfaces across three listeners with
three deliberately different perimeters: the loopback-only management +
pairing server (:9420), the loopback local-http (:17400), and the LAN
companion server (:17500) — the last one existing only when trust exists.

## Peer class before any token work

`is_lan_peer` (`src-tauri/src/commands/fleet/companion_api.rs:192-203`)
is guard #1 in `authorize` (`:223-248`), "evaluated before any token work
so an internet-exposed misconfiguration answers 403 with zero
secret-bearing computation" (`:189-191`). It accepts loopback, RFC-1918
private, and link-local — including the address-family disguise:
IPv6-mapped IPv4 addresses are unwrapped and re-classified (`:196-202`).
The unit test drives both sides — five private classes pass, four public
addresses (including a v6 resolver) refuse (`:606-615`). The docstring
also states the overlay trade honestly: "a user-supplied Tailscale-style
network appears as RFC-1918 and works; the open internet does not"
(`:13-14`).

## The listener exists only while trust exists

The LAN server "exists ONLY after the operator has explicitly paired a
device" (`:6-8`): `fleet_pair_device` starts it as part of the ceremony
(`fleet/pairing.rs:288-290`), and on app restart `start_if_paired`
(`companion_api.rs:73-87`) consults the persisted device store —
`pairing::any_active_device` counts non-revoked rows
(`fleet/pairing.rs:90-92`) — and stays dark otherwise. An unpaired
machine never opens port 17500, which the legacy measurement confirmed on
the live process (`0.0.0.0:17500 NOT LISTENING — nothing paired`,
`docs/concepts/golden-paths/cross-device-pairing.md` §0.1). The gap the
technique names is also real here: revoking the *last* device does not
stop an already-running server — refusal then rests on the empty
registry, not a closed port.

## Allowlists warmed from persisted state

The CORS allowlist for paired cloud origins is a process-global set
(`PAIRED_ORIGINS`, `src-tauri/src/engine/management_api.rs:188-197`)
with the exact lifecycle the technique prescribes:

- **warmed at startup** from the durable registry —
  `load_paired_origins` reads distinct `bound_origin` values of active
  keys, "so approvals survive a restart" (`:221-234`), and a failed load
  starts *empty* with a warning, never stale (`:232`);
- **mutated with the grant**: approval adds
  (`add_paired_origin`, called from `approve_pairing`,
  `external_api_keys.rs:176-178`);
- **revocation re-derives** rather than surgically deletes:
  `revoke_pairing` calls `load_paired_origins(&state.db)` to rebuild the
  set from the database "so the origin drops out once no active key
  references it" (`external_api_keys.rs:213-220`) — convergence on truth,
  and correct even when two keys share an origin.

## Permissive on purpose, with the reasoning written down

The pairing entry router carries the exact comment the technique demands
of a deliberately permissive pre-trust endpoint: "Permissive CORS (any
origin) because the cloud origin is not paired yet — the nonce + user
approval + origin-checked single-use claim are the security, not CORS"
(`engine/src/pairing.rs:332-335`). The permissive layer sits on a
loopback-bound server and mints nothing; the restrictive-CORS management
router rides alongside it on the same port, gated by the warmed
allowlist.
