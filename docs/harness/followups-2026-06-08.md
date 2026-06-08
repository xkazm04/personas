# Bug-hunt follow-ups — deferred work (2026-06-08)

Deliberate deferrals from the bug-hunter remediation waves. Each is a real finding
left undone because a safe fix exceeds a single contained commit. Listed so a
future session picks them up without re-discovering them.

## cloud-sync #1 — sync cursor advances to wall-clock, drops rows (Critical)
- **File:** `src-tauri/src/cloud/sync/mod.rs:225-257` (`sync_table_inner`), fetch predicate `src-tauri/src/cloud/sync/rows.rs` per-table fetchers.
- **Why deferred:** `sync_table_inner` is generic over `T` (the row type) and advances the cursor to `tick_start` (wall clock at pass start, line 255), not to `max(cursor_col)` of the rows actually fetched and confirmed-pushed. The correct fix needs the per-table `fetch` closure to *also* return the max cursor timestamp it saw (or `T` to expose its cursor column), so `sync_table_inner` can do `set_cursor(max(seen_ts, cursor_prev))`. That changes the `fetch` signature and **every** table fetcher in `rows.rs`. A wrong partial fix to a data-loss-critical watermark risks worse loss, so it was held back rather than rushed.
- **Recommended fix:** Change `fetch` to return `(Vec<T>, Option<String> /* max cursor ts */)`; advance the cursor to that max only after a confirmed `client.upsert`. `upsert` is idempotent, so a conservative cursor (slightly behind) only causes harmless re-syncs — never loss.

## cloud-sync #2 — fixed 24h resync window misses in-place mutations (High)
- **File:** `src-tauri/src/cloud/sync/mod.rs:241-245`, `SYNC_TABLES` `mod.rs:49-61`, `rows.rs` fetch predicates.
- **Why deferred:** Mutable tables watermark on `created_at` + a 24h `resync` floor, so an in-place mutation (e.g. a `running` execution cancelled 3 days later, a review resolved a week after creation) older than 24h never re-syncs — the cloud mirror shows stale status forever. The fix is to watermark every mutable table on a true `updated_at` that bumps on **every** UPDATE and use `updated_at > cursor` (dropping the `created_at` + 24h hack). This needs `updated_at` columns/triggers on the affected tables → a migration, plus per-table fetch-predicate changes.
- **Recommended fix:** Add/confirm `updated_at` (with an `AFTER UPDATE` trigger or explicit bump) on `synced_executions`, `reviews`, healing tables, etc.; switch their fetch predicate + cursor column to `updated_at`. Pairs naturally with #1's `fetch` refactor.

> Both are best done together as one "data-driven sync cursor" change with focused tests (insert-during-pass, in-place-mutation-after-window) before touching the live mirror.

## p2p #1/#2/#3(registry)/#5 — signed-challenge handshake KEYSTONE (3× Critical + 1 High)
- **Files:** `engine/p2p/{transport.rs,connection.rs,protocol.rs,mdns.rs,manifest_sync.rs}`, `engine/identity.rs` (primitives), trust storage in `db/repos/resources/identity.rs`.
- **Why deferred:** Findings #1 (unauthenticated peer identity), #2 (mDNS trusts advertised id), the registry half of #3 (owned-device accepts unverified peers), and #5 (unsigned manifests) all hinge on ONE missing primitive: a handshake that proves the remote holds the private key for the `peer_id` it claims. Today QUIC uses `SkipServerVerification` (transport.rs:153) with a throwaway cert unrelated to the Ed25519 identity, and Hello/HelloAck (protocol.rs:21, connection.rs:350-377) carry `peer_id` as an unsigned string echo. Building a crypto handshake is a security-protocol design task — a subtly-wrong one (nonce reuse/replay, accept-before-verify, wrong pk→id binding) creates a false sense of security that is *worse* than the documented-known gap, and it warrants careful design + crypto review + the p2p test harness rather than a rush at the tail of a long remediation run.
- **Primitives already present** (`engine/identity.rs`): `sign_message(pool, &[u8]) -> Result<String>` (242), `verify_signature(pub_b64, msg, sig_b64) -> Result<bool>` (334), `public_key_to_peer_id(&VerifyingKey) -> String` (74). Add a small `peer_id_from_public_key_b64(&str) -> Result<String>` wrapper for the verify side.
- **Recommended design:**
  1. **protocol.rs:** add `public_key: String` (b64) to `Hello`/`HelloAck`; add two messages `Challenge { nonce: String }` and `ChallengeResponse { signature: String }` (b64 over the raw nonce bytes). Bump `PROTOCOL_VERSION` (breaks un-upgraded peers — acceptable same-app, note it).
  2. **connection.rs (both directions):** after Hello/HelloAck, each side sends a fresh 32-byte random nonce (`OsRng`), receives the peer's nonce, returns `sign_message(nonce)`, and verifies the peer's `ChallengeResponse` with `verify_signature(hello.public_key, our_nonce, sig)`. Then assert `peer_id_from_public_key_b64(hello.public_key) == claimed peer_id`. Reject (drop the connection) on any failure. Only mark the connection/`discovered_peers` row **verified** after this passes.
  3. **transport.rs:** ideally use the Ed25519 identity key as the QUIC cert keypair and pin the cert SPKI to the expected peer_id inside `SkipServerVerification` instead of blindly asserting; at minimum keep the app-level signed challenge as the trust anchor.
  4. **#2 (mdns.rs):** never derive `trust_status = trusted` from the advertised id — keep it `unverified` until step 2 proves the key; keep last-verified-addr separate from last-advertised-addr and only dial verified addresses.
  5. **#3 registry (owned_devices.rs):** require a verified identity before `register_owned_device` persists; store the peer's public key alongside `peer_id` and reject re-registration of the same id with a different key. (The manifest half — never serving `requires_auth` resources — is already fixed: `b236eff21`. Once verification exists, gate `requires_auth` resources on verified-owned peers instead of fail-closed.)
  6. **#5 (manifest_sync.rs/exposure.rs):** sign the `ExposureManifest` with the owner's Ed25519 key; verify on receipt against the connection's *verified* peer key before `upsert_peer_manifest`; compute `signature_verified` from the actual check, never caller input.
- **Verify with:** `cargo check --features desktop,p2p` (compiles clean today). Add unit tests for: valid handshake, wrong-key rejection, pk↔peer_id mismatch rejection, replayed nonce rejection.

## p2p #4 — revoked peers resurrect on next mDNS tick (High)
- **Files:** `db/repos/resources/identity.rs:240-265` (revoke/delete), `engine/p2p/mdns.rs:128-181` (`validate_mdns_peer`), `:464-472` (`prune_stale_peers`).
- **Why deferred:** Needs a durable deny-list table (a migration) plus consult points; bundled with the handshake session since it touches the same mDNS/trust code.
- **Recommended fix:** Add `revoked_peers(peer_id TEXT PRIMARY KEY, revoked_at TEXT NOT NULL)` (migration). `revoke_peer_trust`/`delete_trusted_peer` INSERT into it; `validate_mdns_peer` drops/hard-marks any announcement whose id is tombstoned; `prune_stale_peers` never resurrects them. Make revocation a fact about the identity, not a transient `discovered_peers` row.

## p2p #6 — connection insert/dispatch not atomic (Medium)
- **File:** `engine/p2p/connection.rs:272-298, 407-414, 539-557`.
- **Why deferred:** Reliability fix in tie-break/connection-lifecycle code; lower priority than the security keystone and best done with the p2p test harness.
- **Recommended fix:** Spawn the inbound dispatch loop inside the same critical section that inserts the connection (store its `JoinHandle`/cancel token in `PeerConnection`), and treat the post-insert DB write as best-effort/retryable rather than a teardown trigger, so a live "Connected" peer always has exactly one loop servicing its streams.

## personal-twin #4 — profile update lost-update (High)
- **File:** `src-tauri/src/db/repos/twin.rs:157-227` (`update_profile`), `src/stores/slices/system/twinSlice.ts:336-346`, `src/features/plugins/twin/sub_identity/IdentityAtelier.tsx:68-81`.
- **Why deferred:** `update_profile` is a blind full-field overwrite with no optimistic-concurrency guard, so a stale form copy silently clobbers a concurrently-generated bio/identity. The correct fix adds an `updated_at` (or `version`) precondition to the `WHERE` clause and returns a `Conflict`, which must be threaded through the Tauri command signature, the **ts-rs generated bindings**, the store action, and the component (pass expected `updated_at`, handle `Conflict` by reloading). That's a coordinated Rust+binding+TS change too broad for a single safe commit this run.
- **Recommended fix:** `UPDATE … SET … WHERE id = ?1 AND updated_at = ?expected`; 0 rows → `AppError::Conflict`. Client re-hydrates form state on profile change and prompts on conflict instead of blind-overwriting.

## execution #6 — output-line interleaving across same-persona runs (Medium)
- **File:** `src/hooks/execution/usePersonaExecution.ts:36` (`handleOutputLine`), `src/stores/slices/agents/executionSlice.ts:530` (`appendExecutionOutput`).
- **Why deferred:** `handleOutputLine` receives only the line text, not an `execution_id`, so it can't correlate output the way the status path now does (execution #5, fixed). Closing it needs each `execution-output` event tagged with its `execution_id` and the handler/`appendExecutionOutput` to verify it against `activeExecutionId` (buffering background output under its own key). That requires changing the output event payload + correlated-stream plumbing.
- **Recommended fix:** Tag `execution-output` with `execution_id`; `handleOutputLine`/`appendExecutionOutput` accept + verify it; background output buffers under its own per-execution key.

## execution #2 — concurrency-slot leak on tokio abort (Critical)
- **File:** `src-tauri/src/engine/mod.rs:1117` (cleanup) vs `:1279`, `:1393` (`handle.abort()`).
- **Why deferred:** `engine/mod.rs` had **pre-existing uncommitted working-tree changes** during the bug-hunt run, so a `git add` of the fix would bundle unrelated WIP into the atomic commit (no non-interactive hunk-staging). Commit/stash that WIP, then land the fix on a clean tree.
- **Recommended fix:** Move slot-release + `drain_and_start_next` into a `Drop`-based guard (RAII) so they run on normal completion, panic, **and** abort (`catch_unwind` does not catch abort); or have `force_cancel_all_for_persona` and the cancel-grace-abort path call `drain_and_start_next` explicitly after aborting and clear the tracker/task/waiter maps.
