---
layer: application
subject: device-pairing
technique: pairing-ceremony
stack: rust
---

# The cloud-origin pairing ceremony on the backend

The repo's fullest ceremony is the cloud-app pairing in
`src-tauri/engine/src/pairing.rs` plus the mint gate in
`src-tauri/src/commands/credentials/external_api_keys.rs:155-202`. Two
entry doors — a `personas://pair` deep link
(`register_from_deep_link`, `pairing.rs:227-252`) and
`POST /pair/request` on the loopback server (`:270-298`) — converge on one
pending store through one registrar (`register`, `:87-135`), exactly the
one-door discipline.

## The pending store, by the book

- **Entropy floor**: `MIN_NONCE_LEN = 16` (`pairing.rs:40`); a shorter
  nonce is refused at registration (`:93-95`, pinned by the test at
  `:360-363`).
- **Bounded**: `MAX_PENDING = 32` (`:42`); the cap refuses *new* nonces
  only (`map.len() >= MAX_PENDING && !map.contains_key(nonce)`, `:115`).
- **Expiring**: `PAIRING_TTL = 300` seconds (`:38`), pruned on every store
  access (`prune`, `:77-80`, called in `register`, `list_views`, `claim`).
- **Resolution-stable**: a re-registration under an already-resolved nonce
  returns the existing view instead of resetting to pending
  (`:101-114`) — the comment names the exact failure this prevents: a
  benign double-submit "would otherwise discard an already-minted,
  unclaimed token and hang the app's claim poll indefinitely."

## Channel-stamped identity, not payload identity

`handle_pair_request` takes the origin from the request's `Origin` header
— "NOT a body field, so a page can only ever pair itself"
(`pairing.rs:266-281`). An empty origin is a 400 before registration runs.
The deep-link door necessarily trusts its query parameters for *metadata*
(origin, scopes, name — `:233-247`), which is acceptable because the
record it creates still mints nothing and the claim is origin-checked
later; the credential never rides the deep link (see the
token-binding application).

## The mint gate is one privileged command

Nothing in the engine module can mint. `approve_pairing`
(`external_api_keys.rs:155-202`, `#[requires(privileged)]`) is the only
transition from pending to credential:

1. resolves the pending origin (`pairing::pending_origin`) — a nonce that
   is unknown or already resolved is a `NotFound`, so approve cannot
   re-fire (`:161-162`);
2. stamps a **server-authoritative expiry** — the UI picks a window, the
   backend computes the absolute timestamp, "rather than trust the client
   clock" (`:164-165`, same pattern as key creation at `:29-31`);
3. mints via the same repo door every external key passes through
   (`repo::create` with `Some(origin)` — the origin binding, `:167-174`);
4. warms the live CORS allowlist (`management_api::add_paired_origin`,
   `:178`) and stashes the plaintext for the single-use claim
   (`pairing::set_approved`, `:179`);
5. writes the audit row (`settings_audit_log::insert` with action
   `"pair"`, `:192-200`).

`reject_pairing` (`:207-211`) resolves the record so the requester's poll
gets a definite 403; `list_pending_pairings` (`:142-147`) is the
missed-signal safety net the approval surface queries on mount.

## Deviation worth carrying

The ceremony's scopes are narrowed by the human but validated against no
scope registry at mint — `approve_pairing` passes the modal's strings
straight to `repo::create`. The authorization subject's scope vocabulary
(`docs/concepts/paths/authorization/techniques/scope-design.md`) is the
missing consumer; an unrecognized scope should refuse at the mint gate,
not surprise at enforcement time.
