# Refactor+Perf Fix Wave 4 (E1) — Rust runtime hygiene: blocking, leaks, deadlocks

> 7 commits, 7 findings closed (all High), 9 Rust files. Theme E split: E1 = stability-critical (this wave); E2 (6 findings: webbuild blocking probe, daemon churn-starvation, project-tracking reconsolidation, regex recompile, dream-replay O(n²), serial trigger polling, harness gate reruns) remains open.
> Gates: cargo check --features desktop,ml clean; no frontend files touched (tsc/vitest stand from Wave 2: 0 / 2304/2304). Lib-test execution still blocked machine-wide (loader issue, Wave 2 follow-ups).

## Commits

| # | Commit | Finding | What |
|---|---|---|---|
| 1 | `999c8ede0` | tauri-companion-brain-1-2 #1 | `kill_on_drop(true)` on all three one-shot Claude CLI spawns — timeouts leaked a live claude.exe per call (chat path). |
| 2 | `8f0d1368a` | tauri-commands-credentials-1-2 #1 | `spawn_ingest_job` used `blocking_lock()` on a tokio Mutex from async commands — documented panic on the KB-ingest entry point. Now async + `.lock().await`. |
| 3 | `dae330100` | tauri-commands-credentials-1-2 #2 | Playwright `npx @latest` probe (registry-hitting, minutes cold) ran inline on a tokio worker. Now spawn_blocking + 15s timeout + 5-min cache shared by both call sites. |
| 4 | `7d5069454` | tauri-engine-9-10 #2 | Verification command drained pipes only AFTER wait() — >64KB output deadlocked to full timeout. Now tokio::join! concurrent drain; timeout path keeps partial output. |
| 5 | `a0537ede3` | tauri-engine-p2p #1 | Inbox unbounded on peer-controlled persona keys. Now: 1MB payload clamp + 256-key cap with drop-new (not LRU — id-floods must not evict real personas). |
| 6 | `941095c51` | tauri-engine-2-10 #4 | Slack poller built a fresh reqwest::Client per poll/reply on a 5s loop. OnceLock shared client. |
| 7 | `250dfe891` | tauri-commands-infrastructure-1-3 #4 | Start-competition ran tsc + cargo check inline in the sync IPC command. Baseline capture moved to a spawned thread; row updated best-effort when done. |

## Patterns established (catalogue items 12–15)

12. **Every tokio child spawn that can be abandoned (timeout, ?-return) needs `kill_on_drop(true)`** — tokio does not kill on drop, unlike what std habits suggest.
13. **`blocking_lock()`/blocking subprocess calls are forbidden inside anything reachable from an async command** — spawn_blocking with a timeout, or make the helper async.
14. **Child stdout/stderr must be drained concurrently with `wait()`** (`tokio::join!`), never after — the ~64KB pipe buffer deadlocks chatty children.
15. **Any map keyed by remote-controlled input needs a key-count cap; prefer drop-new over LRU** when an attacker can mint keys (LRU lets the flood evict legitimate entries).

## Cumulative status (waves 1–4)

27 findings closed (1 Critical + 26 High) in 27 commits across 4 waves. Remaining C+H per INDEX: C IPC chattiness (18), E2 Rust hygiene tail (6), F render churn (26), G UI correctness (13), H dead code (23), I duplication (19) + migration-stamp follow-up.
