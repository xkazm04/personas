# Bug Hunter — Companion Brain & Proactivity

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: companion-brain-proactivity | Group: Athena Companion

## 1. Wake gate is decided before the wake is logged → double-wake / duplicate autonomous CLI turns
- **Severity**: Critical
- **Category**: Race condition / latent cost runaway
- **File**: `src-tauri/src/companion/wake_window.rs:67` (gate read) + `src-tauri/src/companion/proactive/execution_review.rs:662` & `753` (gate→work→log_wake) + `src-tauri/src/commands/companion/mod.rs:128-167` (tick has no in-flight guard)
- **Scenario**: The periodic scheduler tick fires every 5 minutes (`PROACTIVE_TICK_INTERVAL`). On a tick, `review_recent_executions` calls `wake_window::gate()`, which decides `due` from `minutes_since_last_wake` = `MAX(created_at)` of `athena_wake_log`. But `log_wake` is only written *after* the headless CLI triage turn finishes (`cli_text_tracked`, which has a multi-minute timeout). If one triage CLI call runs longer than the 5-min interval, the next tick fires, re-reads the log (still showing the *previous* wake, because this pass hasn't logged yet), computes `age >= window`, and spawns a *second* concurrent triage CLI turn over an overlapping cursor window. The UI's `companion_evaluate_proactive_now` button and the debouncer add more concurrent entrypoints. There is no per-surface mutex / `AtomicBool` "in-flight" guard anywhere around these calls.
- **Root cause**: The "last wake" timestamp that the gate depends on is written at the *end* of the work, not claimed *atomically at gate time*. The gate is therefore not idempotent under overlap — it's a check-then-act with a wide async gap and no lock. (Note: the budget path was hardened against exactly this class with an atomic `try_consume`, but the wake gate was not.)
- **Impact**: Duplicate autonomous CLI turns = double token/$ spend per overlap, duplicated cursor advances racing each other (one pass advances the cursor mid-flight of the other → either re-triage of the same window or a silently skipped window), and duplicated `companion://proactive` cards. On a slow/rate-limited CLI this compounds every tick — a self-amplifying cost loop, the textbook "runaway wake."
- **Fix sketch**: Claim the wake atomically at gate time: insert the `athena_wake_log` row (or a per-surface `wake_in_progress` lease row) *inside* `gate()` in the same transaction that reads `MAX(created_at)`, or guard each surface with a per-surface `tokio::sync::Mutex::try_lock()` so an overlapping tick early-returns instead of starting a second CLI turn. Update `duration_ms`/`actions` on the leased row when work completes.

## 2. Autonomous exec/message triage ignores quiet hours entirely
- **Severity**: High
- **Category**: Edge case / silent policy bypass (wake during quiet hours)
- **File**: `src-tauri/src/commands/companion/mod.rs:128-167` (triage calls) vs `src-tauri/src/companion/proactive/quiet.rs:63` (`is_quiet_now`)
- **Scenario**: `is_quiet_now()` is only consulted inside `evaluate_with_extra_candidates` (`proactive/mod.rs:101`) — i.e. the *nudge* pipeline. The two autonomous surfaces spawned on the same 5-min tick, `review_recent_executions` and `triage_unread_messages`, are invoked directly and never call `is_quiet_now`. They gate only on the wake-window timer + priority, which is timezone-agnostic. So during a configured `quiet_hours`/`focus_window` (e.g. 22:00–07:00), Athena still wakes, spends CLI turns, mutates message read-state, and can emit `message_attention`/`execution_review` proactive cards at 3 AM.
- **Root cause**: Quiet-hours enforcement lives in one branch of the pipeline (nudges) but the autonomy expanded to other self-triggering surfaces that bypass it. The guardrail is not centralized at the "may Athena act autonomously right now" boundary.
- **Impact**: Promised "no deliveries during quiet windows" contract is silently violated for the highest-cost autonomous paths. Users who set focus/sleep windows still get woken and still pay for CLI turns during them.
- **Fix sketch**: Hoist the quiet check into the wake gate (or check `is_quiet_now` at the top of each triage surface, with a priority bypass mirroring `has_priority`). Centralize "is Athena allowed to self-trigger now" so every surface inherits quiet-hours, not just nudges.

## 3. Empty / partially-edited quiet window silently turns "quiet" into "always awake"
- **Severity**: High
- **Category**: Silent failure / edge case (empty doctrine-style config)
- **File**: `src-tauri/src/companion/proactive/quiet.rs:81-97`
- **Scenario**: `window_contains` returns `false` the moment `from` or `to` is absent or unparseable (`None => return false`). A ritual row whose `schedule_json` is `{}`, or has a typo'd time (`"7:00"` not `"07:00"` — `parse_hhmm` uses `%H:%M` which requires zero-padding), or is mid-edit with only `from` set, is treated as "not quiet" rather than "config is broken." `is_quiet_now` then reports the user is *not* in quiet hours, and proactive delivery proceeds. The failure is completely silent (no log on the malformed-but-parseable-as-empty path; the `serde` parse-error path at line 70 also just `continue`s).
- **Root cause**: Fail-open defaulting. The module doc deliberately fails-open for `from==to` and empty-days (defensible), but the same fail-open is applied to *missing/garbage endpoints*, which is indistinguishable from a half-saved or malformed schedule — exactly the case where you'd want to fail safe (stay quiet) or at least surface the misconfig.
- **Impact**: A user who thinks they configured a sleep window (but mistyped `7:00`) gets woken anyway, with no error anywhere telling them why their quiet hours "don't work." Hard to diagnose because every individual piece looks fine.
- **Fix sketch**: When a ritual is `quiet_hours`/`focus_window` but its schedule fails to yield a valid `(from,to)`, emit a `tracing::warn!` with the ritual id and either (a) treat it as quiet (fail-safe) or (b) surface a one-time "your quiet-hours ritual looks misconfigured" signal. At minimum, log it so it's diagnosable.

## 4. Brain memory + proactive_message tables grow unbounded (no retention)
- **Severity**: Medium
- **Category**: Latent failure (unbounded growth → drift & slow queries)
- **File**: `src-tauri/src/companion/proactive/mod.rs:166-211` (insert, no prune) + `src-tauri/src/commands/companion/proactive.rs:358` (`get_by_id` comment notes "proactive rows are never pruned")
- **Scenario**: `companion_proactive_message` rows are inserted on every nudge/scheduled/external enqueue and *never deleted* — the `get_by_id` doc comment explicitly states "proactive rows are never pruned" as the justification for an O(1) lookup. Background jobs *are* pruned (`jobs::prune_terminal_jobs`, 30-day) and turn-ledger is pruned, but the proactive message table, episodes (`companion_node` episodes, cap-200 only on *read*), and the wake log have no retention. The budget/engagement-modulation queries (`engagement_30d`, `modulations_summary`) scan `companion_proactive_message` filtered by `created_at >= -30 days` every single delivery; on a multi-year install this scans an ever-growing table on a hot path.
- **Root cause**: Retention was added for jobs/turns/events but not for the proactive-message ledger or wake log. The "never pruned" decision optimized one lookup while leaving aggregate scans and disk growth unaddressed.
- **Impact**: On long-lived installs the table accumulates indefinitely; the per-delivery `engagement_30d`/`modulations_summary` scans degrade, the BrainViewer list counts (cap-200/500 reads) silently truncate so the user sees a wrong "N items," and `companion_list_proactive_messages` ordering scans a growing table. Slow, silent drift rather than a hard failure.
- **Fix sketch**: Add a prune pass (mirroring `prune_terminal_jobs`) for `companion_proactive_message` resolved rows older than N days and for `athena_wake_log` beyond the 24h window the stats need. Index `companion_proactive_message(trigger_kind, created_at, status)` to keep the engagement scans cheap.

## 5. Project registry path uniqueness is case/normalization-naive → tracking drift on Windows
- **Severity**: Low
- **Category**: Edge case / data drift (project tracking drift)
- **File**: `src-tauri/src/companion/projects.rs:101-124` (upsert keyed on raw `path`)
- **Scenario**: `register` upserts `ON CONFLICT(path)` using the raw string. On Windows the same repo can be referenced as `C:\Users\kazda\kiro\personas`, `c:\users\kazda\kiro\personas`, with a trailing slash, or via forward slashes — all distinct strings but the same directory. `seed_default_project` computes its path from `CARGO_MANIFEST_DIR` (one canonical form), while a user `register_project` op may supply another casing. Each distinct string creates a *separate* `companion_known_project` row, and `register` then also `INSERT OR IGNORE`s a separate `dev_tools_project_subscription` per row.
- **Root cause**: Path identity treated as byte-equality with no normalization (no `canonicalize`, case-fold, or separator/trailing-slash trimming) before the UNIQUE check.
- **Impact**: Duplicate project entries for one repo; watchers/subscriptions and `last_scan_at` split across the duplicates, so "list projects" shows phantoms and scan/tracking state drifts (a scan recorded against one row while nudges/tracking read another). Low severity because it requires the user to register manually with a divergent path.
- **Fix sketch**: Normalize the path before insert/conflict — `std::fs::canonicalize` (or at minimum trim trailing separators, unify `/`↔`\`, and case-fold on Windows) and store the canonical form, so all spellings of one repo collapse to a single registry row + subscription.
