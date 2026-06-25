# Companion Brain & Proactivity — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: companion-brain-and-proactivity | Group: Athena Companion
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. Wake gate is a non-atomic read — message_triage & channel_reactions lack the reentrancy guard exec_triage has, so concurrent reachability double-fires the autonomous CLI
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race condition / cost runaway
- **File**: src-tauri/src/companion/proactive/message_triage.rs:261-304 ; src-tauri/src/engine/subscription.rs:2609-2637 (contrast the guard at src-tauri/src/companion/proactive/execution_review.rs:660)
- **Scenario**: `wake_window::gate()` is a pure read (`minutes_since_last_wake` SELECT) with no claim — it does not record the wake; `log_wake` only runs *after* the expensive `cli_text_tracked` call completes. exec_triage protects itself with `TRIAGE_INFLIGHT.guard("exec_triage")` precisely because the same leg is reachable from both the 5-min background tick (`commands/companion/mod.rs:104`) and the manual `companion_review_recent_executions_now` IPC command (`chat.rs:162`). The sibling legs — `triage_unread_messages` and the engine `channel_reactions` tick — make equally expensive autonomous CLI calls through the identical gate→CLI→log_wake shape but have **no** such guard. If two passes are concurrently reachable (an overlapping engine-subscription tick, or any future "triage my inbox now" affordance mirroring the exec-review one), both read the gate before either writes `log_wake`, both see `age >= window`, and both fire the CLI.
- **Root cause**: Mutual exclusion of a wake is delegated to per-surface in-flight guards instead of being a property of the gate itself; only one of the three surfaces actually installs the guard. Unlike `budget::try_consume` (atomic conditional UPDATE), the wake gate has no atomic-claim equivalent.
- **Impact**: Duplicate headless CLI spend (runaway proactive execution), duplicate "Athena reached out"/channel posts, and double cursor advance that can skip unread messages past the user.
- **Fix sketch**: Either (a) add the same `INFLIGHT.guard("message_triage")` / `guard("channel_reactions")` wrappers, or (b) make `gate()` itself claim the wake atomically (conditional INSERT into `athena_wake_log` gated on `minutes_since_last_wake >= window` in one transaction), so the second racer reads the just-written row and skips.
- **Value**: impact=7 effort=2

## 2. `delivered` nudges are never aged out — permanent dedupe starvation + unbounded table growth
- **Severity**: High
- **Lens**: bug-hunter + ambiguity-guardian
- **Category**: silent never-fires / unbounded growth
- **File**: src-tauri/src/companion/proactive/mod.rs:175-217 (dedupe + retention prune), :438-447 (`resolve` is the only exit from `delivered`)
- **Scenario**: `enqueue_if_new` dedupes against `status IN ('queued','delivered')`. The only transition out of `delivered` is `resolve()` (engage/dismiss). A user who simply ignores the "Athena reached out" card leaves the row `delivered` forever. No code anywhere transitions a `companion_proactive_message` to `expired` (verified: the only `'expired'` references in the tree are on unrelated tables in `engine/digest.rs` and `observability.rs`). Consequences: (a) for any trigger with a stable `trigger_ref` — `dev_goal_stalled` on goal X, `backlog_aging` on item Y — that goal/item is **never nudged again** once one card is ignored; (b) the retention prune at :212 explicitly skips `queued`/`delivered`, so ignored cards accumulate without bound.
- **Root cause**: `delivered` is treated as a terminal-ish state for growth purposes but a blocking state for dedupe, with no time-based escape hatch. The prune's stated goal ("table doesn't grow unbounded", :169) is silently false for the most common real-world status.
- **Impact**: High-value proactivity (stalled goals, aging backlog) silently goes dark after a single ignored card; on a long-lived install the table grows monotonically, slowing the dedupe scan and `list_messages`.
- **Fix sketch**: Add a sweep (run opportunistically alongside the prune) that ages `delivered` rows older than N days to `expired` — that simultaneously unblocks re-nudging for the trigger and makes the row eligible for the existing retention prune. Keep `queued` untouched.
- **Value**: impact=6 effort=3

## 3. Daily budget resets on UTC date while quiet hours use Local time — up to ~2× intended proactive volume for off-UTC users
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: timezone semantics / cost
- **File**: src-tauri/src/companion/proactive/budget.rs:233-249 (`today` keys on `Utc::now().format("%Y-%m-%d")`) vs src-tauri/src/companion/proactive/quiet.rs:64-65 (`Local::now()`)
- **Scenario**: The "max 12 deliveries/day" ceiling rolls over at UTC midnight, but quiet hours (and the user's lived "day") are local. For a user at UTC−10/+12, UTC midnight lands mid-afternoon, so a single local day spans two budget windows and can surface up to 24 cards. The three subsystems disagree on what "a day" is: budget=UTC, quiet=Local, wake-log=UTC.
- **Root cause**: Convenience of a `WHERE date = ?` key on a UTC calendar string, never reconciled with the local-time guardrails it is supposed to bound. Documented ("Tracked per UTC date") but the cross-module inconsistency is undocumented tribal knowledge.
- **Impact**: The anti-spam guarantee the user feels (a sane number of pings per day) is violated for off-UTC users on busy days; an ambiguity that becomes a real over-delivery cost.
- **Fix sketch**: Key the budget on the same local calendar date the quiet-hours check uses (`Local::now().format("%Y-%m-%d")`), or make the "day" boundary a single shared helper used by budget + quiet so they can't drift. Document the chosen day-boundary once.
- **Value**: impact=4 effort=4

## 4. `seed_default_project` persists the compile-time CARGO_MANIFEST_DIR path — broken default project on every shipped build
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: project-tracking desync / edge case
- **File**: src-tauri/src/companion/projects.rs:154-169 (seed) + the register fallback at :101-103
- **Scenario**: The default project path is `env!("CARGO_MANIFEST_DIR").parent()` — baked at *compile* time. On the dev machine that resolves to the real repo, so it works. On any binary built in CI / on a different machine and then installed (the app ships as a Tauri desktop install), that directory does not exist on the user's disk, so `std::fs::canonicalize` fails and the fallback persists the bogus *build-machine* path verbatim. The seeded "Personas" project (and its auto-created subscription) then points at a non-existent directory.
- **Root cause**: A compile-time constant used as a runtime filesystem location, with a fallback that happily stores a path known not to exist.
- **Impact**: For every non-dev install, the out-of-the-box project ("so 'list projects'/'scan project X' have something to act on") points nowhere; git/active-run watching and scans against it silently no-op or error — exactly the "project-tracking with no usable projects" edge case.
- **Fix sketch**: Resolve the default project path at runtime (current working dir / a known install-relative anchor), or skip seeding when the computed path fails to `canonicalize`, surfacing a one-time "register your repo" prompt instead of a phantom project.
- **Value**: impact=5 effort=3

## 5. `log_wake` swallows its write error — a failed wake record re-arms the gate every tick (wake storm) and hides the spend
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: swallowed error / cost runaway
- **File**: src-tauri/src/companion/wake_window.rs:74-100 (`log_wake` — `let Ok(conn) = pool.get() else { return }` and `let _ = conn.execute(...)`), depended on by the gate at :67-71
- **Scenario**: After a surface wakes and runs its CLI call, `log_wake` is best-effort: if `pool.get()` or the INSERT fails (e.g. SQLITE_BUSY under WAL write contention) the error is discarded. `minutes_since_last_wake` then keeps returning the stale prior wake — or `None` if no wake ever landed — so on the next 5-min tick the gate still reports `due` while the backlog persists, re-running the expensive CLI. Because the failure is swallowed, the `athena_wake_log` autonomy-impact ledger also under-reports the real spend, so the storm is invisible in telemetry.
- **Root cause**: The gate's "has this surface woken recently?" decision is derived from a write that is allowed to silently fail, with no fallback (e.g. an in-memory last-wake timestamp) and no retry/alert.
- **Impact**: Sustained DB contention turns into repeated autonomous CLI spend with no visible signal — a quiet cost runaway and a corrupted impact ledger.
- **Fix sketch**: Treat `log_wake` failure as significant — at minimum `tracing::warn!` (not `let _`), and back the gate with an in-process `last_wake` cache (or fold the wake-record write into the same atomic gate claim from finding #1) so a transient DB write failure cannot re-arm the timer.
- **Value**: impact=5 effort=3
