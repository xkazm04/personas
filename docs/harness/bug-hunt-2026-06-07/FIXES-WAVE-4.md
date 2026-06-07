# Bug Hunter Fix Wave 4 — Atomicity / TOCTOU

> 5 commits, 5 findings closed (3 Critical, 2 High). 1 Critical (execution slot-leak) **deferred** — see below.
> Baseline preserved: `cargo check --features desktop,ml` 0 errors → 0 errors.

## Commits

| # | Commit | Finding | Severity | File(s) |
|---|---|---|---|---|
| 1 | `f0cb85f05` | recipes #2 start TOCTOU duplicate runs | Critical | `lib.rs`, `commands/recipes/crud.rs` |
| 2 | `25f2eab91` | companion #2 proactive budget burst | Critical | `companion/proactive/{budget,mod}.rs` |
| 3 | `b3273a23b` | companion #3 doctrine ingest duplicates | High | `companion/brain/doctrine.rs` |
| 4 | `691001f78` | research #2 run_number TOCTOU | High | `db/repos/research_lab.rs` |
| 5 | `0ffee6deb` | credential-recipes #1 refresh-token brick | Critical | `engine/oauth_refresh.rs` |

## What was fixed (grouped)

**Atomic claim / serialized read-modify-write (#recipes2, #companion2, #research2)**
1. **Recipe start is now an atomic claim.** `start_recipe_execution/generation/versioning` guarded with a `get_id()`-then-`set_id()` pair straddling an `.await`; two concurrent starts both passed and the second's `set_id` overwrote the first, so the first's completed (billed) result was misclassified as cancelled and discarded. Added `ActiveProcessRegistry::try_begin` (check-and-install under one lock) and routed all three starts through it.
2. **Proactive budget cap is now atomic.** The cap was checked against a per-pass snapshot read; two overlapping passes each delivered up to `DAILY_CAP` → up to 2× the nudges. Replaced `increment()` with `try_consume()` — a single `UPDATE … SET count=count+1 WHERE count<cap` — used by both budget consumers.
3. **Experiment run_number is allocated in a transaction.** `MAX(run_number)+1` then a separate `INSERT` on pooled (independent) connections produced duplicate run numbers. Wrapped both in `BEGIN IMMEDIATE`.

**Serialized idempotent ingest (#companion3)**
4. **Doctrine ingest serialized.** `ingest_all` (startup) and `companion_reingest_doctrine` (button) both run a select-then-insert per chunk with no UNIQUE constraint; overlapping passes duplicated every chunk + its FTS/embedding rows. Serialized `ingest_all` behind a process-wide `tokio::Mutex`.

**Irreversible external step before local commit (#credrecipes1)**
5. **OAuth refresh persist retried.** The provider invalidates the old refresh_token the instant it returns the new one, but a transient local persist failure rolled the transaction back and kept the dead old token → permanent brick. The persist is now retried with backoff (3 attempts) before surfacing the error.

## Deferred this wave

**execution #2 — concurrency-slot leak on `handle.abort()` (Critical, `engine/mod.rs`).** Slot release + `drain_and_start_next` live inside the spawned task body, so a tokio `abort()` (persona deletion / cancel-grace timeout) drops the future without running them — the engine wedges at capacity until restart. **Not fixed here because `engine/mod.rs` has pre-existing uncommitted changes in the working tree**; a `git add` of that file would bundle unrelated WIP into the atomic fix commit, and hunk-staging isn't available non-interactively. **To proceed:** commit or stash the existing `engine/mod.rs` changes, then this fix can land cleanly (the fix is to move slot-release + queue-drain into a `Drop` guard, or have `force_cancel_all_for_persona` and the cancel-grace-abort path call `drain_and_start_next` explicitly after aborting).

## Verification

| Check | Result |
|---|---|
| `cargo check --features desktop,ml` errors | 0 (baseline 0) |
| `tsc --noEmit` | 0 (no TS touched) |
| Files modified | 7 |

> Concurrency/abort fixes are hard to unit-test deterministically, so no new tests this wave; correctness rests on the atomic-primitive / transaction / lock guarantees and review. `companion/brain/doctrine.rs` is `#[cfg(feature = "ml")]` — verified with `--features desktop,ml` (not plain `desktop`).

## Cumulative status (waves 1 + 3 + 4)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Crypto — fail closed | 5 (2C / 3H) |
| 3 | Trust-boundary input validation | 6 (2C / 3H / 1M) |
| 4 | Atomicity / TOCTOU | 5 (3C / 2H) — +1C deferred |

**16 of 73 findings closed** (7 Critical, 8 High, 1 Medium). Remaining: 12 Critical (incl. the deferred execution slot-leak), 22 High, 23 Medium across waves 2, 5, 6, 7.

## Patterns established (catalogue items 11–14)

11. **Check-then-act across an `.await` / pooled connection (TOCTOU)** — `get_id()`+`set_id()`, `MAX()`+`INSERT`, read-budget+increment: any read-decide-write not held under one lock/transaction races, because the r2d2 pool hands out independent connections and async code yields at `.await`. Fix with one atomic primitive (`try_begin`), one conditional `UPDATE … WHERE <guard>`, or `BEGIN IMMEDIATE`. *Grep:* `get_id(`/`is_some()` then `set_id(`; `MAX(` then `INSERT`; `is_exhausted()` then `increment(`.
12. **Irreversible external side effect before local commit** — an external party commits a non-undoable change (OAuth refresh-token rotation) before the local write; a rollback then discards the only valid state. Never drop an irreversible external result on a transient local failure — retry or stage it. *Grep:* network/exchange returning a new secret, followed by a transaction that can roll back and `return Err`.
13. **Idempotency by app-level lookup-then-insert** — "SELECT; if none, INSERT" asserts an idempotency the DB doesn't enforce; concurrent callers both see none and both insert. Use a DB-level upsert / UNIQUE constraint, or serialize the op with a process lock. *Grep:* a `SELECT … WHERE` immediately followed by a conditional `INSERT` with a fresh id, no UNIQUE/tx.
14. **Cleanup in the task body instead of a guard** — slot release / queue drain placed inside a spawned task is skipped by `tokio` `abort()` (`catch_unwind` does not catch abort). Put invariant-restoring cleanup in a `Drop` guard, or have every abort path run it explicitly. *(From the deferred execution #2 — catalogued for when it lands.)*

## What remains

Open themes (per INDEX): Wave 2 P2P/remote-control auth, Wave 5 sync data-loss, Wave 6 panics/integrity, Wave 7 autonomous control/success-theater — plus the deferred execution slot-leak (Wave 4 leftover).
