# Refactor+Perf Fix Wave 3 — SQLite query efficiency & schema debt (Theme D)

> 4 commits, 4 findings closed (3 fully + 1 partial/deferred-with-reason), all Rust/SQL.
> Gates: cargo check --features desktop,ml clean; no frontend files touched (tsc/vitest stand from Wave 2: 0 / 2304/2304). Lib-test execution still blocked machine-wide (STATUS_ENTRYPOINT_NOT_FOUND, see Wave 2 follow-ups).

## Commits

| # | Commit | Finding | What |
|---|---|---|---|
| 1 | `709d8330a` | tauri-db-models-3-4 #1 | MCP `arena_get_results` selected migration-dropped columns — tool failed 100% of calls on real installs. SELECT + row mapping fixed. |
| 2 | `62943de98` | tauri-db-repos-3-6 #1 | team_channel hot-path queries wrapped `created_at` in strftime()/datetime() in WHERE/ORDER BY — index-defeating on an append-only table read at every orchestrator step. Now sargable (normalize the cursor parameter, not the column). |
| 3 | `9f2fdd6b7` | tauri-cloud-misc #1 | Cloud sync full-scanned all ~11 synced tables per pass. Expression indexes on `datetime(col)` make the existing format-normalizing predicate an index seek. Raw-column comparison was REJECTED: writers mix to_rfc3339 and datetime('now') formats which mis-compare lexically. |
| 4 | `9ac9cbb19` | tauri-db-misc #1 (partial) | Guarded the two real per-boot writes: persona_memories trigger DROP+CREATE (journal write every launch) and lab_user_ratings dedup full-table scan (unique index already enforces). |

## Deferred with reason — migration version stamp (tauri-db-misc #1 core)

The finding's sketch ("stamp PRAGMA user_version after a successful run, early-return when matched") is **unsafe as written**. Verified during implementation: the chain has **load-bearing re-execution** — `team_channel_messages.deliberation_id` is ALTERed at incremental.rs:~3611 but the table's CREATE is at ~5664, so on a fresh install the ALTER silently fails on pass 1 and only converges on pass 2 (the next launch). A one-pass stamp would permanently break fresh installs. Fixing this needs a dedicated session: topologically order the chain (or move the CREATEs ahead of dependent ALTERs), add a fresh-DB single-pass convergence test, then stamp. There may be more such order-dependent pairs among the ~40 tolerated-error ALTERs.

## Patterns established (catalogue items 9–11)

9. **Never wrap an indexed column in a function in WHERE/ORDER BY** — normalize the parameter side, or add an expression index that matches the query's expression tree exactly.
10. **Before "simplifying" datetime handling to raw string compares, audit writer formats** — `to_rfc3339()` (`...T...+00:00`) and `datetime('now')` (`... ...`) mis-compare lexically (`' ' < 'T'`).
11. **`CREATE ... IF NOT EXISTS` chains that tolerate errors can hide order dependencies that make re-execution load-bearing** — verify fresh-DB single-pass convergence before adding any run-once stamp.

## Cumulative status (waves 1–3)

20 findings closed (1 Critical + 19 High) in 20 commits across 3 waves. Remaining C+H per INDEX: C IPC chattiness (18), E Rust hygiene (13), F render churn (26), G UI correctness (13), H dead code (23), I duplication (19) + migration-stamp follow-up.
