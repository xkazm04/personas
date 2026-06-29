# Combined-Scan Fix Wave 10 — Knowledge/memory + messaging data integrity

> 6 atomic fix-commits, 6 findings closed (all High) — no deferrals.
> Dispatched as 6 parallel edit-only fix-subagents (disjoint files).
> Baseline preserved: **cargo memories 41/0, slack_poller 4/0, webhook 34/0 + compile; tsc 0; vitest 1979/7 (no regressions)**.

## Commits

| # | Commit | Finding | Stack |
|---|---|---|---|
| 1 | `69ef184d8` | knowledge #1 (memory merge data-loss) | Rust + FE |
| 2 | `b8ecbe0de` | knowledge #2 (LLM importance clobber) | Rust |
| 3 | `9af41b5dd` | messages #2 (notification backlog flood) | Rust |
| 4 | `6bafdf9dc` | webhooks #2 (concurrent delivery 500) | Rust |
| 5 | `729308959` | webhooks #3 (Slack burst skip) | Rust |
| 6 | `719901a0b` | trigger #1 (live-stream buffer reset) | FE |

## What was fixed

1. **Memory merge destroyed pinned/scoped memories.** `repo::merge` inserted a tier-less/scope-less row then deleted both originals, killing a `core` pin, demoting active→working, dropping `use_case_id`, and reassigning a cross-persona memory. Now refuses core + cross-persona merges, carries the stronger tier + use_case_id + source/team, and the modal mirrors the guard. +4 tests.
2. **LLM review clobbered user importance.** The review auto-applied a score→importance map to every kept memory, knocking a user-pinned 5 down to 3 (and including `core`). Now only raises (`max(existing, mapped)`), skips `core`, and the magic map is named constants.
3. **First subscription flooded with history.** The dispatch watermark was never seeded while there were 0 subscriptions, so the first sub replayed the entire backlog 200-at-a-time. Now seeds the watermark forward to the newest event (no dispatch) before the zero-sub return + on a None watermark.
4. **Concurrent webhook delivery dropped the event.** A trigger-version CAS conflict returned 500 with the event never inserted. Now the `persona_event` insert runs first and unconditionally; a 0-row CAS is logged + treated as success-after-publish (200), not a 500.
5. **Slack poller skipped a burst.** On >50 messages/tick the cursor jumped to the newest page, stranding the gap forever. Now pages backward to drain the full `(cursor, now]` range before advancing (dedup-safe, `MAX_DRAIN_PAGES` capped). +test. Durable Socket Mode fix is a follow-up.
6. **Live stream wiped its buffer on roster changes.** A spurious `[personas]` dep re-ran the backfill effect on every roster mutation, resetting the 200-event buffer to the top-100. Changed to run-once (`[]`); `useEventBusListener` carries live updates.

## Verification

| Gate | Result |
|---|---|
| cargo (memories / slack_poller / webhook) | 41/0 · 4/0 · 34/0 + compile |
| `tsc --noEmit` | 0 |
| `vitest run` | 1979 pass / 7 pre-existing fail (no regressions) |

## Patterns established (catalogue items 30–32)

30. **Merge/replace that drops metadata = silent data loss** — inserting a "merged" row from a partial input and deleting the originals destroys tier/scope/ownership the originals carried. Carry the stronger metadata forward and refuse merges that would cross a protected boundary (pinned, cross-owner).
31. **Auto-applied derived value overwriting a user-set one** — a pipeline that rewrites importance/priority unconditionally erodes user intent. Only move in the safe direction (raise-only), skip user-pinned rows, and prefer proposal-over-mutation.
32. **Unseeded watermark replays history** — a cursor seeded only on first successful dispatch floods a new consumer with the whole backlog. Seed it forward (to now/newest) when the consumer set goes from empty→non-empty.

## Cumulative status (Waves 1–10)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–9 | security → companion/orchestration | 50 (6C/44H, 2C mitigated) |
| 10 | Knowledge/memory + messaging integrity | 6 (6H) |

**Total: 56 findings addressed across ~71 commits, 0 regressions.** 6/6 scan Criticals fixed-or-mitigated; **50 of 81 Highs closed.**
**Remaining:** ~31 High (the long tail) + Med/Low. Candidate Wave 11+: artist file-leak + thumbnail OOM, drive IPC loop, db-migration chat_messages rebuild + credential blob migration, MCP cache invalidation, dashboard refetch + healing-as-failure, design-reviews crash, onboarding stale timeouts, persona-editor icon gate, home FleetHealthStrip unmounted, observability alert-history-50, obsidian subfolder sync, build-sessions persist-unvalidated, trigger event-type SQL mismatch, i18n RTL, credential-design negotiator, settings exposure, genome #2.
