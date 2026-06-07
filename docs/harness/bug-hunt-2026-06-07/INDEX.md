# Bug Hunter Scan — personas, 2026-06-07

> Elite systems-failure analysis of the personas desktop app (Tauri 2 + Vite/React 19 + Rust).
> 12 parallel subagent runs across 4 high-risk context groups, batched in 2 waves of ≤8.
> Scope: **high-risk groups, full-stack** (both `src/` TS and `src-tauri/` Rust). Target: 4–6 findings/context.

---

## Totals

|  | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 12 contexts | 19 | 30 | 24 | 0 | **73** |
| Share | 26% | 41% | 33% | 0% | 100% |

> Counts verified two ways: `> Total:` header sum = 73; `- **Severity**:` bullet count = 73. ✓

---

## Per-context breakdown

(Sorted by criticals desc, then total)

| # | Context | Group | Crit | High | Med | Total | Report |
|---|---|---|---:|---:|---:|---:|---|
| 1 | p2p-network-device-sync | Network & Sync | 3 | 2 | 1 | 6 | [report](p2p-network-device-sync.md) |
| 2 | creative-productivity-plugins | Companion & Plugins | 2 | 3 | 2 | 7 | [report](creative-productivity-plugins.md) |
| 3 | companion-athena | Companion & Plugins | 2 | 3 | 1 | 6 | [report](companion-athena.md) |
| 4 | credential-recipes-oauth-rotation | Connections & Credentials | 2 | 2 | 2 | 6 | [report](credential-recipes-oauth-rotation.md) |
| 5 | credential-vault-connectors | Connections & Credentials | 2 | 3 | 1 | 6 | [report](credential-vault-connectors.md) |
| 6 | mcp-tools-gateways-knowledge-base | Connections & Credentials | 2 | 3 | 1 | 6 | [report](mcp-tools-gateways-knowledge-base.md) |
| 7 | cloud-sync | Network & Sync | 1 | 3 | 2 | 6 | [report](cloud-sync.md) |
| 8 | personal-twin | Companion & Plugins | 1 | 3 | 2 | 6 | [report](personal-twin.md) |
| 9 | triggers-and-event-automations | Execution & Orchestration | 1 | 2 | 3 | 6 | [report](triggers-and-event-automations.md) |
| 10 | recipes-automation-library | Execution & Orchestration | 1 | 2 | 3 | 6 | [report](recipes-automation-library.md) |
| 11 | execution-engine-runs | Execution & Orchestration | 1 | 2 | 3 | 6 | [report](execution-engine-runs.md) |
| 12 | research-lab | Companion & Plugins | 1 | 2 | 3 | 6 | [report](research-lab.md) |

---

## All 19 critical findings — one-line summary

Grouped into themes for triage. File refs are real, cited from the per-context reports.

### A. Unauthenticated trust boundaries / spoofing (P2P + remote control)
1. **p2p — Peer identity fully unauthenticated end-to-end.** QUIC `SkipServerVerification` accepts any cert (cert key ≠ Ed25519 identity), and the Hello/HelloAck takes `peer_id` as an unsigned plaintext claim — any LAN attacker impersonates a trusted peer. `engine/p2p/transport.rs:153,124-131`, `connection.rs:350-377`
2. **p2p — mDNS discovery trusts advertised `peer_id`/address with no proof.** Trust is keyed on a spoofable broadcast string → trusted-peer impersonation + address poisoning. `engine/p2p/mdns.rs:128-181,161,428-443`
3. **p2p — Owned-device registry & manifest sync accept unverified peers.** `register_owned_device` takes a bare `peer_id`; manifests served to any connected peer with no `requires_auth` gate. `commands/network/owned_devices.rs:33-54`, `discovery.rs:94-105`, `connection.rs:680-683`

### B. Input validation / injection / path traversal at the Rust enforcement boundary
4. **mcp — Safe-mode SQL classifier treats CTE-wrapped writes as read-only.** `WITH … (DELETE/INSERT/UPDATE …) SELECT …` is classified read-only and runs without the mutation guard (frontend catches it; the Rust enforcement layer does not) → silent data loss. `engine/db_query.rs:221,200,311,2070`
5. **creative — `obsidian_brain_list_vault_files` accepts arbitrary paths.** `Path::join` honours an absolute/`..` argument → leaks arbitrary directory listings outside the vault. `commands/obsidian_brain/mod.rs:1224-1299`

### C. Crypto / secret protection fail-open
6. **credential-vault — Master-key fallback is fail-OPEN by default.** Falls back to a local-file key unless an undocumented `PERSONAS_DENY_FALLBACK_KEY=1` is set; the doc/error promise the opposite opt-in flag (never read). A transient keychain hiccup silently downgrades vault protection. `engine/crypto.rs:428-469` (gate `442-457`)
7. **credential-vault — Unix fallback accepts an attacker-plantable raw 32-byte master-key file** with no integrity check. `engine/crypto.rs:860-869,571-654`

### D. Non-atomic persist / TOCTOU state corruption
8. **credential-recipes — OAuth refresh-token rotation is consumed server-side before the local commit.** A transient encrypt/keyring failure rolls back the DB, leaving it holding the now-revoked old token → credential permanently bricked, no auto-recovery. `engine/oauth_refresh.rs:498-531`
9. **recipes — TOCTOU in `start_recipe_execution`/`start_recipe_versioning`.** Non-atomic get-then-set guard lets double-clicked/concurrent starts both pass → duplicate Claude CLI runs, a completed (billed) result silently discarded. The atomic `begin_run` primitive already exists but isn't used. `commands/recipes/crud.rs:213,294,431`
10. **execution — Slot release + queue drain live *inside* the spawned task.** `handle.abort()` (persona deletion / cancel-grace timeout) drops the future without running cleanup → running slot leaks and `drain_and_start_next` never fires, wedging the engine at capacity until restart. `engine/mod.rs:1117` vs `:1279,:1393`
11. **companion — Proactive daily-budget cap is non-atomic (read-then-increment).** Concurrent passes burst past the cap → notification storm. `companion/proactive/budget.rs:48,36`

### E. Silent data loss — sync watermarks & filename collisions
12. **cloud-sync — Sync cursor advances to wall-clock pass-start time, not `max(confirmed row ts)`.** Rows committed during the slow push window (and any in-place mutation older than the 24h resync window) are silently dropped from the mirror, no error, no reconciliation. `cloud/sync/mod.rs:239-256`, `rows.rs:496-509`
13. **triggers — Smee relay re-fires every buffered webhook on each SSE reconnect (no dedup).** Any network blip replays the channel history → duplicate persona executions. Sibling cloud-webhook relay already uses a persisted watermark; smee has nothing. `engine/smee_relay.rs:258-392,567-630`
14. **creative — Vault push-sync overwrites notes that sanitize to the same filename.** DB state keyed by `entity_id` but the file keyed by lossy `sanitize_filename(title)` → two memories clobber each other's note on disk, both report success; next pull corrupts a DB row. `commands/obsidian_brain/mod.rs:499-576`

### F. Referential integrity
15. **research-lab — Findings store `source_ids`/`hypothesis_ids`/`experiment_ids` as JSON TEXT.** Deleting a referenced row leaves dangling refs SQLite cascade can't scrub → broken citations / crashes on later deref. `db/models/research_lab.rs:225`, `repos/research_lab.rs:469`

### G. Panic / edge-case crash on input
16. **personal-twin — UTF-8 byte-slice panic on multi-byte content.** `&content[..len.min(500)]` panics on any multi-byte char crossing the cut — near-certain crash for a multilingual personal-comms feature; DB row inserted but command errors (inconsistency). `db/repos/twin.rs:587`, `commands/infrastructure/twin.rs:2138`
17. **credential-recipes — `now_unix_secs()` returns 0 on a pre-epoch clock.** Mints OAuth state tokens that instantly fail their own freshness check → every OAuth flow rejected. `commands/credentials/oauth.rs:330-335`
18. **mcp — `kb_search` never validates query-embedding model/dimensions against the index** that was built → silent wrong results or hard failure when the embedding model changes. `commands/credentials/vector_kb.rs:691,700`

### H. Loss of control over the autonomous agent
19. **companion — Autonomous "Stop = type anything" cancel is defeated by the same turn that schedules the next tick.** One global `AtomicBool`; if Athena's reply emits `continue_autonomously`, `reset_autonomous_cancel()` clears the user's stop → the loop keeps firing. Needs a monotonic generation token. `companion/session.rs:832,149`, `commands/companion/chat.rs:77`

---

## Triage themes

Detected by clustering the `Category:` field + scenario keywords across all 73 findings. Counts include criticals + highs + mediums.

| Theme | ~Count | Why this is a wave, not just individual fixes |
|---|---:|---|
| T1. Unauthenticated peer/remote trust (spoofing) | ~6 | All share one missing primitive: bind trust to a *proven key/signature*, not a self-asserted string. Fix the handshake once → cascade closes. |
| T2. Input validation / injection / path traversal | ~6 | Same root: the Rust command is the real enforcement boundary but trusts UI-shaped input. One "validate at the boundary" pass. |
| T3. Crypto fail-open / secret protection | ~4 | Crypto must fail *closed*; today several paths downgrade silently. Shared mental model: no implicit fallback to weaker primitive. |
| T4. Non-atomic persist / TOCTOU | ~7 | Read-modify-write without a lock/transaction, and cleanup that doesn't survive `abort()`. One atomicity discipline. |
| T5. Sync watermark / dropped writes (data loss) | ~6 | Watermark = `max(confirmed)`, not wall-clock; dedup on reconnect. Identical fix shape across smee/cloud/webhook. |
| T6. Filename/key collision overwrite (data loss) | ~2 | Lossy key used as a unique file identity. Make the on-disk key injective. |
| T7. Referential integrity / dangling refs | ~2 | Relationships modeled as JSON id-lists in TEXT instead of FK join tables. |
| T8. Panic / edge-case crash on input | ~4 | `unwrap`/byte-slice/dim-assumptions on external input. Fail loud + validate, don't slice blindly. |
| T9. Silent failure / success theater | ~6 | Swallowed errors that report success (sends, deletes, batch items, output capture). Surface the failure. |
| T10. Optimistic store / wrong correlation (frontend) | ~3 | Zustand updates without rollback; events correlated by persona instead of execution-id. |
| T11. Autonomous control / consent gates | ~4 | Auto-execute/auto-author/auto-continue without a genuine consent or cancel guarantee. |
| T12. Rate-limit / starvation / unbounded growth | ~3 | Per-source rate limits that let one producer starve others; budgets that burst. |
| T13. Stale process/cache reuse | ~2 | Warm-pool/gateway processes reused with stale command/env after edits. |

---

## Suggested next-phase split (7 fix waves)

Each wave shares one mental model so fixes compound; ~5–7 findings each.

**Wave 1 — Crypto: make the vault fail closed** (theme T3)
- credential-vault #1 master-key fallback fail-open (C)
- credential-vault #2 attacker-plantable raw master key (C)
- credential-vault legacy plain-RSA IPC decrypt fail-open (H)
- credential-vault client-supplied `healthcheck_passed` trust (H)
- credential-vault readiness "Ready" on bare row existence (H)

**Wave 2 — P2P & remote-control authentication** (theme T1) — *largest/hardest; may need its own session (introduces a signed-challenge handshake primitive)*
- p2p #1 unauthenticated peer identity (C)
- p2p #2 mDNS trusts advertised id (C)
- p2p #3 owned-device/manifest accept unverified peers (C)
- p2p tombstone resurrection of revoked peers (H)
- p2p unsigned manifests / unenforced provenance (H)
- cloud-sync remote-approval no content-binding nonce + TOCTOU (H)

**Wave 3 — Trust-boundary input validation** (theme T2)
- mcp #1 CTE-wrapped write bypass (C)
- creative #2 vault-files path traversal (C)
- creative drive `resolve_safe` symlink escape (H)
- creative `artist_read_image_base64` arbitrary path + OOM (H)
- mcp gateway `::` tool-name separator unvalidated (H)
- companion STT accepts any same-size blob as audio (M)

**Wave 4 — Atomicity: lock the read-modify-write / survive abort** (theme T4)
- credential-recipes #1 oauth refresh brick (C)
- recipes #2 start TOCTOU duplicate runs (C)
- execution #2 slot leak on abort (C)
- companion #2 proactive budget non-atomic (C)
- companion doctrine ingest non-transactional dup (H)
- research-lab run-number TOCTOU race (H)

**Wave 5 — Data-loss: watermarks, dedup, injective file keys** (themes T5+T6)
- cloud-sync #1 cursor drops rows written during pass (C)
- triggers #1 smee no event dedup (C)
- creative #1 vault filename-collision overwrite (C)
- cloud-sync webhook watermark skips failed publish (H)
- cloud-sync 24h resync window strands mutations (H)
- triggers chain cascade double-fire (CAS bool discarded) (H)

**Wave 6 — Edge-case panics & integrity** (themes T7+T8)
- personal-twin #1 UTF-8 byte-slice panic (C)
- credential-recipes #2 `now_unix_secs()`==0 clock (C)
- mcp #2 kb_search embedding dim/model mismatch (C)
- research-lab #1 dangling JSON-id refs (C)
- mcp `embed_batch` zip drops chunks → zombie rows (H)

**Wave 7 — Autonomous control, success theater & correlation** (themes T9+T10+T11)
- companion #1 autonomous cancel race (C)
- companion approval auto-execute TOCTOU + renameable athena name guard (H)
- personal-twin ReplyOutbox wrong-recipient "sent" record (H)
- personal-twin identity Save stale full-field overwrite / lost update (H)
- execution events correlated by persona not execution-id (H)
- recipes playground double-instantiates test-runner (History always empty) (H)

> Remaining mediums (event source-type rate-limit starvation, foraging provenance trust, OAuth `state` echo, `cloud_disconnect` leaves loops running, distilled-facts no dedup, studio batch success-theater, etc.) fold into the closest wave or a cleanup Wave 8.

---

## How this scan was run

- **Scanner**: Bug Hunter (`agent_bug_hunter`, scanType `bug_hunter`) from `vibeman/src/lib/prompts/registry/agents/bug-hunter.ts` — elite systems-failure analyst; focus: latent failures, race conditions/timing, edge cases, silent failures.
- **Date**: 2026-06-07.
- **Scope**: high-risk groups (Execution & Orchestration, Connections & Credentials, Network & Sync, Companion & Plugins) = 12 contexts; full-stack (`src/` + `src-tauri/`); target 4–6 findings/context.
- **Method**: 12 isolated `general-purpose` subagents (2 waves of 8 + 4), each read its context's file scope read-only and wrote one structured report. Orchestrator read only terse replies during scanning, then compiled this INDEX from the report headers + critical sections.
- **Files read by subagents**: ~154 source files total.
- **Verification**: findings counted two ways (header sum = severity-bullet count = 73). Per-context severity re-derived from file content (2 subagent self-reports had a minor High/Medium mislabel; INDEX uses authoritative file counts).
- **Baseline (Phase B2)**: `tsc --noEmit` = 0 errors. vitest/eslint binaries not installed in this checkout (partial `node_modules`) — per-fix verification uses `tsc --noEmit` (+ `cargo check` for Rust changes).
