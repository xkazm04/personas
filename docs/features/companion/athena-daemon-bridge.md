# Athena Daemon Ambient Bridge (Phase 3 c v3)

**Status:** Shipped 2026-05-09 across 7 atomic commits (`3a44b8360` → `44894728a` + step 7 e2e tests). File-watcher producer wired 2026-05-11 (`8b7cdd7d`).
**Pairs with:** [`ambient-context-fusion.md`](../../concepts/ambient-context-fusion.md) (in-memory model — partial; Fix A closed by the 2026-05-11 producer), [`../../architecture/athena-phase1-audit.md`](../../architecture/athena-phase1-audit.md) (foundation audit), [`./athena-cli-session-awareness.md`](./athena-cli-session-awareness.md) (sibling Phase 5).
**Source roots:** `src-tauri/src/engine/ambient_signal_repo.rs`, `src-tauri/src/daemon/runtime.rs::inject_ambient_for_daemon`, schema in `src-tauri/src/db/migrations/schema.rs` (`ambient_signal` table).

---

## TL;DR

The `personas-daemon` binary (cron triggers, scheduled events, webhook fires) runs as a **separate process** from the windowed Tauri app. The windowed app's `AmbientContextFusion` is in-memory only — its rolling window of clipboard / app-focus signals never reaches the daemon's address space. Phase 3 c v1 wired ambient injection into the **windowed** runner at `engine/mod.rs::run_execution_with_ceiling`; Phase 3 c v3 closes the equivalent gap for the daemon by projecting captured signals into a SQL table both processes share.

> **Capture in process A → SQL row → load in process B → render → prepend to system prompt.**

The bridge is a single new table (`ambient_signal`) plus two write hooks (clipboard_monitor + AppFocusSubscription) plus one read site (daemon `run_one`) plus a TTL eviction tick.

## Design space considered

| Option | Why not | Why this one |
|---|---|---|
| **A — SQL projection** | _(this design)_ | Reuses existing infrastructure: both endpoints already take `DbPool` (verified before implementing). Persists across restarts. Cross-platform. Reversible (drop the table). |
| B — UDS / named-pipe stream | Connection lifecycle (daemon may start before windowed app and have empty state until app boots), per-OS code, no persistence. | Possible v4 latency optimization. |
| C — Daemon-pull IPC | Re-introduces dependency on the windowed app being live — defeats the daemon's purpose. | — |
| D — Shared memory ring buffer | Platform-specific, lock-free serialization fragile, schema versioning across processes is a footgun. | — |
| E — Daemon captures its own signals | Two clipboard listeners on one machine race; redaction runs twice with potentially different decisions, breaking the privacy contract. | — |

## Data flow

```
windowed-app process                                    daemon process
─────────────────────                                   ──────────────
clipboard_monitor::clipboard_tick
  └─ AmbientContextFusion.push_clipboard_with_content
       └─ returns Some(AmbientSignal)
       └─ ambient_signal_repo::insert_signal (sync)
           │
           ▼
        ambient_signal table  ◄────────────────────────  recent_signals(pool, since, max)
          (main DB; not the                                     │
          per-user companion DB)                                ▼
           │                                          inject_ambient_for_daemon (runtime.rs)
           │                                                    │
           ▲                                                    ▼
AmbientSignalEvictionSubscription                    SensoryPolicy filter
  (every 30 min)                                              │
  evict_older_than(now - 24h)                                 ▼
                                                     format_signals_for_prompt
                                                     (shared renderer; step 4)
                                                              │
                                                              ▼
                                                     prepend_ambient_to_system_prompt
                                                     (Phase 3 c v1; mutates persona)
                                                              │
                                                              ▼
                                                     runner::run_execution
```

The same `format_signals_for_prompt` is used by `AmbientContextFusion::format_for_prompt` (windowed path) and the daemon. Byte-identical rendering for byte-identical input.

## Privacy posture

The contract from Phase 3 v1 is unchanged: **redaction at capture** (JWT / AWS / Stripe / GitHub / Slack / Bearer / email patterns) before the signal enters either the rolling window or the SQL row.

Two privacy bounds:

1. **Per-source capture-time gates.** `clipboard_enabled` / `app_focus_enabled` / `file_changes_enabled` are checked inside `push_*` BEFORE the signal is created. A toggled-off source produces no row.
2. **TTL eviction.** `AmbientSignalEvictionSubscription` runs every 30 min and deletes rows older than 24h. The threat surface widens in *time* relative to the in-memory window (~5 min by default, capped by `SensoryPolicy::max_age_secs`), not in *kind* — a redaction false-negative would leak in either store.

The window-title redactor and clipboard-content redactor (`redact_window_title`, `redact_clipboard_content` in `ambient_context.rs`) are the load-bearing privacy primitives. Adding new patterns to either backfills naturally on the next capture.

## Policy choice in the daemon

The daemon uses `SensoryPolicy::default()` rather than per-persona policies. Per-persona overrides live in the windowed app's in-process `AmbientContextFusion::policies` HashMap and are not (yet) projected to SQL. Two reasons this is acceptable for v3:

- **Capture-time gates already filter what reaches SQL.** A user who disabled clipboard will see no clipboard rows in the daemon's view either way.
- **Per-persona policy is a consumption-side scoping tool**, not a privacy boundary. The privacy boundary is the capture-time gate. Tuning which-persona-sees-which-source can come in a v4 if it matters in practice.

## Active-app label omitted in daemon prompts

`AmbientContextFusion`'s `current_app` / `current_window_title` fields are in-process state — they're populated by `push_app_focus` in memory but not (yet) projected to a SQL column. The daemon path therefore renders the prompt **without** the `**Active Application**: ...` header; the most-recent `app_focus` row in the "Recent Activity" list still surfaces the same information inline, just less prominently.

A future enhancement could parse the newest `app_focus` summary (format: `"Focused: {app_name} — {redacted_title}"`) to reconstruct the label without adding a new column.

## TTL choice — 24h

- Privacy posture: rows are post-redaction, but durability shouldn't grow unbounded.
- Daemon utility: a daemon-fired persona that wants to reference "what the user was doing earlier today" is the design intent. Multi-day windows add little value (a daemon trigger acting on yesterday's clipboard signal is more likely noise than signal).
- Aligns with the existing companion daily-budget cadence in the proactive pipeline.

The TTL is a single constant (`AMBIENT_SIGNAL_TTL_SECS` in `subscription.rs`) — easy to tune per-deployment if needed.

## Failure modes (all non-fatal)

| Stage | Failure | Behavior |
|---|---|---|
| Capture-side INSERT | Pool error / disk full | `tracing::warn!`, in-memory window unaffected, daemon misses one signal. |
| Daemon-side SELECT | Pool error | `tracing::warn!`, run without ambient context (= pre-Phase-3-c daemon behavior). |
| Eviction tick DELETE | Pool error | `tracing::warn!`, next tick (30 min) retries. |
| Empty filtered signal list | n/a | `format_signals_for_prompt` returns `None`, `prepend_*` is a no-op. |

## Known limitations / future work

1. ~~**`file_watcher` signals not yet captured.**~~ **CLOSED 2026-05-11 (`8b7cdd7d`).** `engine/file_watcher.rs::file_watcher_tick` now takes an `Option<&AmbientContextHandle>` and pushes each coalesced + debounced event through `AmbientContextFusion::push_file_change`. The capture-time `file_changes_enabled` gate (Phase 2) decides whether the row reaches the in-memory window AND the SQL mirror — file activity now flows to daemon-fired personas for free, no separate plumbing needed. `FileWatcherSubscription`'s previously-`#[allow(dead_code)]` `ambient_ctx` field is now load-bearing.
2. **macOS / Linux active-window watchers.** Windows is the only implemented platform for `app_focus`; Phase 4 will close that. (Out of scope for the 2026-05-11 completion pass — needs platform-specific testing infrastructure not available from the Windows host.)
3. **Per-persona policy projection.** Daemon path uses default policy; per-persona overrides aren't visible cross-process.
4. **Active-app label parsing.** Daemon-rendered prompts omit the header; future enhancement could parse the newest `app_focus` summary.
