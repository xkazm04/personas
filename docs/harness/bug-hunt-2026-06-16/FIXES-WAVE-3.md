# Bug Hunter Fix Wave 3 — Data-loss: watermark / cursor advance-on-failure

> 2 root-cause fixes closing 3 critical findings.
> Theme: advance a cursor/watermark only to what you actually confirmed — never
> to wall-clock `now()`, and never past a unit of work that failed.
> Baseline preserved: `cargo check --features desktop` 0 → 0 errors. No frontend
> changes (tsc still 0; the 5 pre-existing vitest failures are unrelated).

## Commits

| # | Commit | Finding(s) closed | File(s) |
|---|---|---|---|
| 1 | `906645e6d` | messages-notifications #1 **+** webhooks-channel-pollers #1 (same root cause) | `src-tauri/src/engine/webhook_notifier.rs` |
| 2 | `d39a6f503` | cloud-sync-deployment #1 | `src-tauri/src/cloud/sync/rows.rs`, `src-tauri/src/cloud/sync/mod.rs` |

Two scanners independently reported the webhook-watermark bug from different contexts; one fix closes both findings.

## What was fixed

1. **Webhook notifier watermark advances past failed deliveries.** `tick()` advanced the global dispatch watermark to the newest event's `created_at` every tick regardless of per-(event,subscription) delivery success. A transient endpoint outage (5xx/timeout/DNS blip, or a not-yet-decryptable credential) returned `outcome.ok=false`, but the watermark moved past the event anyway, and `get_recent_after` only returns `created_at > watermark` — so every Slack/Discord/Teams/generic notification due during the outage was silently, permanently lost (no retry, no outbound DLQ; only the subscription's `last_error` hinted at it). Fix: track the earliest event with any failed delivery this tick and never advance the watermark to or past it, so a later tick re-fetches and re-delivers once the endpoint recovers. Re-delivery of already-succeeded events at/after that timestamp is the accepted cost of a time-based watermark.
2. **Sync cursor set to `now()` instead of the max observed timestamp.** `sync_table_inner` captured `tick_start = now()` at pass start, fetched on a separate pooled connection via `spawn_blocking`, then set the cursor to `tick_start`. Any row committed after the SELECT's read snapshot but stamped before `tick_start` wasn't returned, yet the cursor moved past it — so the changed-since filter excluded it from every later pass. For config tables (personas, memories, triggers) with no resync window, the loss was permanent and silent while `is_clean()` stayed true. Fix: the row-fetch helper now selects the watermark column under a `__cursor_val` alias and returns the max value present in the result set; the pass advances the cursor to that observed max (or leaves it unchanged when empty), which can never be ahead of an unread row. Threaded the `(rows, max)` tuple through all 11 `fetch_*` wrappers; the tombstone path is unchanged. The changed-since read wraps both sides in `datetime()`, so the stored value's format is irrelevant.

## Verification (before / after)

| Gate | Baseline | After Wave 3 | Notes |
|---|---|---|---|
| `cargo check --features desktop` | 0 errors | 0 errors | Each fix verified + final full check. |
| `tsc --noEmit` | 0 errors | 0 errors | No frontend files changed. |
| `vitest run` | 5 pre-existing failing | 5 (same) | Unchanged — no frontend changes. |

No regressions introduced.

## Cumulative status (across all waves)

| Wave | Theme | Criticals closed | Commits |
|---|---|---:|---|
| 1 | Concurrency / missing-CAS double-execution | 5 | `c3ab4aa7f` `6e960f1b5` `fa326eb14` `9d1de3d78` `0ff899369` |
| 2 | Security & trust-boundary | 5 | `b8f759842` `a3eebc13c` `a02e21210` `34a3fc3f3` `a0b13eaec` |
| 3 | Data-loss: watermark/cursor | 3 | `906645e6d` `d39a6f503` |

Criticals closed: **13 / 42**. Findings closed overall: **13 / 260**.

## Patterns established (catalogue additions, items 10–11)

10. **Advance a cursor/watermark only to what you confirmed — never wall-clock `now()`.** A pass that stamps the watermark = `now()` at start and then reads on a separate snapshot/connection skips any row committed between the snapshot and `now()`, permanently if there's no resync window. Advance to the max timestamp actually present in the synced result set (or leave unchanged if empty); it can never be ahead of a row the pass didn't read.
11. **Don't advance a shared high-water mark past a failed unit of work.** A loop that bumps a per-tick watermark regardless of per-item success permanently drops items that failed when there's no retry/DLQ path. Hold the watermark below the earliest failure so a later pass re-fetches; accept duplicate re-delivery of succeeded items at/after that point as the cost of a time-based watermark (a per-item retry cursor is the fuller fix).

## What remains

29 criticals across the other themes (see `INDEX.md`). Related data-loss items still open (High): shared-event relay cursor (no id tiebreaker + advances on publish failure), `messages` non-transactional title-only dedup, poller burst > FETCH_LIMIT skips. Next highest-leverage waves per the INDEX plan: **Recovery/healing & execution-runtime** (healing success-theater, drain-and-start stranded queue, fan-in predecessor drop, incident continuation with None input) and **Foundation multipliers** (tauriInvoke dedup shared reference, i18n interpolate panel-blank, credential-ledger regex wipe).
