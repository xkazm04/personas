# Combined-Scan Fix Wave 3 — Scheduler + watermark/sync data-flow

> 2 atomic commits, 4 findings closed (1 Critical + 3 High); 1 High deferred (needs migration).
> Dispatched as 3 parallel edit-only fix-subagents (disjoint files). Baseline preserved: lib + harness compile clean; **scheduler 25/0, backfill 9/0, webhook_notifier 16/0** (incl. 3 new breaker tests); TS untouched.

## Commits

| # | Commit | Finding(s) | Severity | Outcome |
|---|---|---|---|---|
| 1 | `bc58d84b7` | scheduler #1, #2, #3 | Critical + High + High | **Fixed** (no migration) |
| 2 | `416a5f4ca` | messages #1 (webhook_notifier) | High | **Fixed** (no migration, 3 tests) |
| — | (deferred) | cloud-sync #1 | High | **Needs migration** → follow-up C |

## What was fixed

1. **Cron backfill watermark poisoned (Critical).** `mark_triggered` advanced `last_triggered_at` on every *skip* (over-budget, out-of-window, rate-limited), so after a pause the auto-backfill window `(last_triggered_at, now]` collapsed to ~5s and days of missed runs silently never replayed. Added a CAS `advance_schedule_pointer` (bumps `next_trigger_at`+version, leaves `last_triggered_at` alone); the three skip paths use it, so the schedule pointer still advances (no re-fire) while `last_triggered_at` stays the true last-fired watermark.
2. **User backfill no dedupe / no cap (High).** `backfill_schedule` re-clicks multiplied executions up to 100×. Added `events::backfill_slot_times_for_source`; backfill now skips already-published slots and applies the per-slot hourly cap the auto path already had. (Explicit-payload triggers carry no slot marker → degrade to no-dedup, same as prior behavior; closing that needs a slot-time column.)
3. **Backfill wrong-hour on bad timezone (High).** Backfill `.ok()`-fell-back to system-local on an unparseable zone (≈6h off) while the live path refuses. Added a shared `resolve_schedule_tz`/`ScheduleTzError` used by all three sites; backfill returns empty slots (command returns a Validation error) on a bad zone.
4. **Dead webhook pins the global watermark (High).** One permanently-failing subscription set `earliest_failed` every tick, pinning the single global dispatch cursor → endless duplicate re-POSTs to healthy subs + eventual loss of new notifications past the 200-event window. Added an in-memory consecutive-failure circuit breaker (threshold 5, re-probe every 12 ticks): a broken sink is skipped and excluded from `earliest_failed`; transient failures still retry; resets on success/restart.

## Deferred (needs migration) → `docs/harness/followups-2026-06-26.md` item C

**Cloud-sync in-place-mutation resync (High).** All 5 in-place-mutating sync tables key both watermark and resync off the immutable `created_at`, so a mutation >24h after creation never re-pulls → the cloud dashboard is permanently, silently stale (local is authoritative, so staleness not data loss). None of the 5 tables has an `updated_at` column and many UPDATEs touch no timestamp — a correct fix needs a migration (add `updated_at` ×5 + bump it in every mutating repo + switch the resync filter). Logged with the full recipe.

## Verification

| Gate | Result |
|---|---|
| `cargo test --lib` (compile) | green (lib + full harness) |
| scheduler / backfill / webhook_notifier tests | 25 / 9 / 16 pass · 0 fail |
| tsc / vitest | unchanged (no TS files) |

## Patterns established (catalogue items 9–11)

9. **Overloaded watermark column** — a single timestamp meaning two things ("schedule pointer advanced" vs "event actually fired") breaks any consumer that needs the second meaning. Split the advance: a pointer-only CAS that doesn't touch the fired-watermark.
10. **One bad sink pins a shared cursor** — a global dispatch watermark held below the earliest *failed* delivery lets a single dead subscriber stall (and duplicate-spam) the whole pipeline. Add a per-sink consecutive-failure breaker that stops a broken sink from holding the cursor.
11. **Asymmetric error policy across call sites** — the same field (timezone) resolved "refuse on bad value" on the live path but "fall back to local" on the backfill path produces wrong-time work. Share one resolver so the policy can't diverge.

## Cumulative status (Waves 1–3)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1 | Security — code-exec / SSRF / path-safety | 5 (2C/2H/1M) |
| 2 | Auth / trust-boundary bypass | 6 (2C mitigated+deferred / 4H) |
| 3 | Scheduler + watermark/sync | 4 closed (1C/3H) + 1H deferred (migration) |

**Deferred follow-ups: 2 Critical (BYOM tag source, template codegen) + 1 High (cloud-sync migration)** — all logged in `followups-2026-06-26.md` with recipes.
**Remaining working set: ~3 Critical (mitigated) + ~70 High** + Med/Low tail. Next: Wave 4 — Races & double-execution (STT mic strand **C**, idempotency double-spawn, repo TOCTOU, wake-gate double-fire, Ask-Athena dropped turn, shared Button double-submit).
