# Audit Fix Wave 5 — Security

> 6 commits, 6 of 7 critical findings closed; 1 deferred (cryptographic handshake redesign).
> Theme: sandbox escape, authorization scoping, secret handling, and a DoS amplifier.
> Baseline preserved: `cargo check --features desktop` clean throughout.
> Branch: `vibeman/audit-2026-06-09`. (This wave deliberately touches auth/credential/secret code — authorized by the wave's scope.)

## Commits

| Commit | Finding | Files |
|---|---|---|
| `cfd2efa4f` | credential-vault #1 — clear-to-empty retains secrets | `db/repos/resources/credentials.rs` |
| `2b6f48deb` | cloud-sync #1 — cross-device command misdirection | `cloud/remote_commands.rs` |
| `14ee563a8` | mcp #1 — SQLite ATTACH/DETACH/VACUUM-INTO sandbox escape | `engine/db_query.rs` |
| `fa8ee0c3d` | deployment #1 — sign_document bypassable path denylist | `engine/path_safety.rs`, `commands/signing/mod.rs` |
| `abf9e808e` | triggers #1 — smee/webhook leaked-URL DoS | `engine/smee_relay.rs` |
| `032b3de12` | deployment #2 — GitLab unmasked-secret 400/leak | `gitlab/converter.rs` |

## What was fixed

1. **credential-vault #1 — secret survives "clear".** `update_with_fields` gated the field DELETE+reinsert on `!field_map.is_empty()`, so submitting `data:{}` (clearing every field, e.g. to revoke a leaked key) skipped the DELETE and the old encrypted rows survived — the UI claimed success while the "removed" secret stayed decryptable. `Some(map)` is now an authoritative field set including empty: DELETE always runs on `Some`; only `None` leaves fields untouched.
2. **cloud-sync #1 — cross-device misdirection.** `remote_command_approve` re-fetched the pending row by id only, while poll/list scope by `target_device_id`. RLS only scopes to the tenant, so a multi-device user could approve a run targeted at device B and execute it on device A (wrong sandbox/creds/tree). The approve fetch now resolves this device and filters `target_device_id=eq.{device}`.
3. **mcp #1 — SQLite sandbox escape.** The write-mode deny-list used `starts_with("ATTACH ")` over raw text, so `ATTACH/**/DATABASE`, `ATTACH\tDATABASE`, or a newline before the verb bypassed it → arbitrary-file ATTACH (cross-DB read/exfil) and `VACUUM/**/INTO 'path'` arbitrary writes. The deny-list now derives the verb via the same comment/whitespace-stripping `extract_first_keyword` the classifier uses, matching normalized `ATTACH/DETACH/VACUUM`.
4. **deployment #1 — sign_document exfil oracle.** The sensitive-credential denylist (SSH keys, cloud creds, wallets) lived only in the renderer's `signDocument` wrapper — bypassable by any direct `invoke("sign_document", …)`. Ported it to `engine::path_safety::is_sensitive_credential_path` and enforce it on the resolved path before any read; the TS guard is now defense-in-depth.
5. **triggers #1 — webhook DoS.** The per-source event rate limiter lived only in the IPC commands; the smee relay (attacker-reachable via a leaked channel URL) called `event_repo::publish` directly with no throttle → unbounded events. The relay now applies the same per-source limit (`AppState.rate_limiter` via `app.state()`) before publishing and drops over-limit events.
6. **deployment #2 — GitLab secret leak/400.** Provisioning set `masked:true` on every value "even if it can't be masked". GitLab 400s an unmaskable masked variable → `try_join_all` aborts mid-batch, stranding already-pushed secrets (or older instances drop masking silently while claiming it). `masked` is now computed from GitLab's real rules (len≥8 + maskable charset, which also excludes whitespace/newlines); unmaskable values are created unmasked with a warning.

## Verification

| Gate | Result |
|---|---|
| `cargo check --features desktop` | clean, 0 errors (ran after every fix) |
| `tsc --noEmit` | 0 (no TS changed this wave) |
| `cargo test --lib` / `vitest` | pre-existing failures only, untouched files |

## Deferred (1 of 7) — needs protocol design + runtime validation

- **p2p #1 — peer identity spoofing.** Peer identity is self-declared in the Hello/HelloAck handshake and never cryptographically proven (QUIC accepts any cert via `SkipServerVerification`), so any LAN attacker can claim a trusted peer's `peer_id` and be marked trusted (root enabler of manifest leakage + owned-device hijack). The fix is a signed-challenge handshake (the device already has an ed25519 identity in `engine/identity.rs`): on connect, challenge the peer to sign a nonce with the key whose public half maps to the claimed `peer_id`, and pin the QUIC cert to that key. This is a wire-protocol change across `engine/p2p/{connection,transport,mdns}.rs` that must be validated against a real second device — deferred rather than shipped untested. `engine/p2p/connection.rs:471` (incoming Hello), `:350` (HelloAck), `transport.rs:171` (SkipServerVerification).

## Patterns reinforced (catalogue, continued)

16. **Deny-lists must run on the same normalized token the classifier uses.** A raw-text `starts_with("KW ")` guard disagrees with a comment/whitespace-stripping classifier — attackers split the verb from the guard. Tokenize once, decide once. (Better: disable the capability structurally — `SQLITE_DBCONFIG_ENABLE_ATTACH` off.)
17. **Authorization predicates belong in one shared query-builder.** Device/tenant scoping enforced at some call sites but omitted at others (approve) is a misdirection bug; make scoping a property of the fetch, not the call site.
18. **Backend re-enforces every renderer guard.** A denylist in untrusted JS is bypassable by any direct IPC caller; mirror it in the privileged backend and treat the frontend as defense-in-depth (pair with a contract test).
19. **Throttle on the bus, not the boundary.** A rate limit on the IPC command but not the internal/attacker-reachable producer (smee relay) leaves the highest-volume path uncapped. Apply the cap where events enter the bus.
20. **Set security flags honestly.** Claiming `masked:true` on an unmaskable value both lies and breaks the batch; compute the flag from the platform's real rules.

## Cumulative status (Tier-1, waves 1–5)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Lost-update writes | 8 / 8 |
| 2 | Transition guards & lock leaks | 5 / 7 |
| 3 | Success theater / silent failure | 4 / 7 |
| 4 | Orphaned processes & recovery gaps | 5 / 5 |
| 5 | Security | 6 / 7 |
| | **Tier-1 criticals fixed** | **28** |

Remaining Tier-1: Wave 6 corruption loops & stream/graph integrity (7), plus the deferred items (p2p #1/#2, teams #1/#2, events #1/#2, composition #6 part b, research #1). Then Tier-2 UI (19) and Tier-3 highs (169).
