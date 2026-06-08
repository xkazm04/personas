# Bug Hunter Fix Wave 5 — Data-loss (sync / dedup)

> 4 commits, 4 findings closed (2 Critical, 2 High). 2 findings (1C cursor watermark, 1H 24h-resync) **deferred** — they need a coordinated sync-fetch-contract + schema refactor; see `followups-2026-06-08.md`.
> Baseline preserved: `cargo check --features desktop` 0 errors → 0 errors.

## Commits

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `5f14d7f15` | triggers #3 chain cascade double-fire | High | `engine/chain.rs` |
| 2 | `0f48c22e8` | creative #1 vault filename collision | Critical | `commands/obsidian_brain/mod.rs` |
| 3 | `0510fa19c` | triggers #1 smee replays on reconnect | Critical | `engine/smee_relay.rs` |
| 4 | `7d6530a32` | cloud-sync #4 webhook watermark skip | High | `engine/cloud_webhook_relay.rs` |

## What was fixed (grouped)

**Replay / duplicate-fire (idempotency at a boundary)**
1. **Chain cascade honours the CAS.** `mark_triggered` is a version-CAS returning whether it won; the chain path treated any `Ok(_)` as success and published, so two concurrent completion handlers both published → double-fired downstream. Now `Ok(true)` publishes, `Ok(false)` skips (another evaluator claimed it) — matching the scheduler path.
2. **Smee relay de-duplicates replays.** smee.io replays channel history on every reconnect; the relay kept no per-event identity, so each transient disconnect re-published every recent webhook → duplicate executions. Added a bounded (512) cross-reconnect dedup keyed by SSE id > `x-github-delivery` > content hash, plus `Last-Event-ID` on reconnect.
3. **Webhook watermark holds at last contiguous success.** A failed earlier firing didn't hold the `max(fired_at)` watermark back, so a later success advanced past it and the failed firing was skipped forever. Now firings are processed oldest-first and a publish failure breaks the trigger (watermark stays at last success; failed + newer retried next poll); the swallowed `debug!` is now a `warn!`.

**Lossy key as unique identity (data loss)**
4. **Vault notes get collision-free filenames.** Push-sync keyed the on-disk file by `sanitize_filename(title)` (lossy, many-to-one) while tracking state by entity id, so two memories that sanitised to the same name clobbered one file (and the return pull cross-contaminated the DB). New entities now get an injective `<title>--<short-id>.md`; existing entities reuse their recorded `vault_file_path`.

## Deferred this wave (see `followups-2026-06-08.md`)

- **cloud-sync #1 (Critical) — wall-clock sync cursor drops rows.** `sync_table_inner` advances the cursor to `tick_start` (pass-start wall clock), not `max(cursor_col)` of the rows pushed, so rows committed during the pass / in-place mutations are silently dropped from the mirror. The correct fix changes the generic `fetch` closure to also return its max cursor timestamp — touching **every** per-table fetcher — so it was held back rather than half-fixed in core data-loss-critical code.
- **cloud-sync #2 (High) — fixed 24h resync window.** Mutable tables watermark on `created_at` + a 24h floor, so an in-place mutation older than 24h never re-syncs. The fix needs `updated_at` watermarking (schema + per-table predicate). Best done together with #1 as one "data-driven sync cursor" change, with tests, before touching the live mirror.

## Verification

| Check | Result |
|---|---|
| `cargo check --features desktop` errors | 0 (baseline 0) |
| `tsc --noEmit` | 0 (no TS touched) |
| Files modified | 4 |

## Cumulative status (waves 1 + 3 + 4 + 5)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Crypto — fail closed | 5 (2C / 3H) |
| 3 | Trust-boundary input validation | 6 (2C / 3H / 1M) |
| 4 | Atomicity / TOCTOU | 5 (3C / 2H) — +1C deferred |
| 5 | Data-loss (sync / dedup) | 4 (2C / 2H) — +1C/1H deferred |

**20 of 73 findings closed** (9 Critical, 10 High, 1 Medium). Deferred: execution slot-leak (C), sync cursor (C), 24h-resync (H). Remaining open: waves 2 (P2P auth), 6 (panics/integrity), 7 (autonomous control) + the deferred set.

## Patterns established (catalogue items 15–18)

15. **Replay idempotency at a reconnect/resume boundary** — any consumer of a replayable stream (SSE, webhook poll-with-history, at-least-once queue) must dedup by a stable per-event id; never assume exactly-once across a reconnect. Bound a recent-id set and use a resume token (`Last-Event-ID`). *Grep:* SSE/`bytes_stream` loops, poll loops that publish, "replay"/"history" endpoints.
16. **Lossy key used as a unique identity** — a many-to-one transform (sanitize, truncate, round, hash-to-short) used as a primary/file/dedup key collides silently. Make the persisted key injective (suffix the entity id) or detect the collision before write. *Grep:* `sanitize`/`truncate`/`format!("{}.md", ...)` whose result becomes a path or map key.
17. **Watermark = max(processed), not max(batch)** — on partial failure, don't advance a high-water mark past the oldest *unprocessed* item; process oldest-first and stop at the first failure, or track per-item ids. *Grep:* `max(...)` over a batch used as a cursor; an `Err` arm that `continue`s while a sibling success advances a shared watermark.
18. **Wall-clock watermark vs data watermark** *(deferred cloud #1, catalogued)* — advancing a sync cursor to "now" instead of to `max(seen data ts)` drops rows written during the pass and in-place mutations. Watermark on the data (`max(cursor_col)`, `updated_at`), never the clock; idempotent upserts make a conservative cursor safe. *Grep:* `set_cursor(now)`/`tick_start` used as the persisted cursor.

## What remains

Open themes (per INDEX): Wave 2 P2P/remote-control auth, Wave 6 panics/integrity, Wave 7 autonomous control/success-theater — plus the deferred set (execution slot-leak, sync cursor, 24h resync).
