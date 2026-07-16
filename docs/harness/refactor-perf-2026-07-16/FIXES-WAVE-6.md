# Refactor+Perf Fix Wave 6 (E2) — Rust runtime hygiene tail + harness

> 6 commits, 6 findings closed (all High): 5 Rust + 1 TS. Theme E now fully closed (E1+E2 = 13/13).
> Gates: cargo check --features desktop,ml clean; tsc 0; vitest **2304/2304** (0 regressions, covers waves 5+6 frontend changes); eslint clean per-commit.

## Commits

| Commit | Finding | What |
|---|---|---|
| `0351aa19d` | tauri-utils-misc #1 | sanitize_secrets compiled 4 regexes per call on every audit/error path → OnceLock statics. |
| `e52596053` | tauri-engine-6-10 #1 | Serial trigger polling (one dead endpoint delayed all others 30s/stall) → poll_one_trigger + for_each_concurrent(4); existing CAS dedupes races. |
| `f7a739a62` | tauri-webbuild #1 | Sync commands ran the ~2s blocking dev-server probe on the MAIN thread per poll → async + spawn_blocking. |
| `f59205117` | tauri-daemon-misc #1 | claim-then-release ping-pong re-claimed the same events every 5s and starved headless events → claim_pending_headless (SQL-side personas join). |
| `ec54c9ce7` | tauri-engine-project-tracking #1 | Push path re-fed 24h of consolidated events to Sonnet per push and inflated pulse counters (delta accumulation) → watch_since watermark + update_last_pulse_at stamp. |
| `87980c72a` | lib-harness #1 | Full gate suite (incl. 3-min non-required vite build) reran after every area iteration → required-only per iteration, full suite once post-loop. |

## Patterns established (catalogue items 19–21)

19. **Filter ownership in the claim query, not after claiming** — claim-then-release to the same queue position is write churn plus starvation.
20. **Every out-of-band path that consumes a watermark must also ADVANCE it** — a fixed-window fallback re-processes and (with delta-accumulating sinks) double-counts.
21. **Sync Tauri v2 commands run on the main thread** — anything that can block >a few ms must be an async command (worker pool) or spawn_blocking.

## Cumulative status (waves 1–6)

46 findings closed (1 Critical + 45 High) in 45 fix commits + 6 summaries across 6 waves. Remaining C+H per INDEX: C IPC chattiness (18), F render churn (26), H dead code (23), I duplication (19) + deferred migration-stamp follow-up. Mediums/Lows: 926 in backlog.
