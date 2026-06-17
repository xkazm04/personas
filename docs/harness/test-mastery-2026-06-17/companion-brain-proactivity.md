# Test Mastery — Companion Brain & Proactivity

> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

Context: Athena's long-term brain/doctrine memory + proactive wake-ups that let
her self-initiate work and track projects. Group: Athena Companion.

**Coverage snapshot (honest read):** the *pure* trigger/quiet/budget logic is in
excellent shape — `triggers.rs`, `quiet.rs`, and `budget.rs` all carry unit +
proptest suites that pin documented contracts (cadence firing window, midnight
no-wrap, `from==to` zero-length, per-kind vs global cap, engagement modulation).
The gaps are almost entirely in the **persistence + transaction layer**
(`proactive/mod.rs`), the **autonomy gate** (`wake_window.rs`), and the
**project registry** (`projects.rs`) — none of which have a single `#[cfg(test)]`
module. These are exactly the paths that decide *whether Athena spams the user*,
*whether she ever wakes up*, and *whether project tracking points at the right
repo* — high blast radius, currently uncovered. Frontend `parseBrainLinks` is
already tested; `BrainViewer` is a large untested component but mostly view glue.

---

## 1. Proactive dedupe + resolve lifecycle has zero persistence tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/proactive/mod.rs:159-211 (`enqueue_if_new`), :420-458 (`resolve`)
- **Current test state**: none
- **Scenario**: `enqueue_if_new` is the spam gate — it suppresses a new nudge
  when an unresolved (`queued`/`delivered`) row with the same
  `(trigger_kind, trigger_ref)` already exists. If a regression changed the
  status set (e.g. accidentally including `engaged`/`dismissed`, or dropping the
  `COALESCE(trigger_ref,'')` null-normalization), Athena would either re-fire the
  same nudge every 30-minute tick (spam) or permanently mute a resolved trigger
  from ever firing again (silence). Both are user-visible trust failures and
  *nothing* would catch them today. The `resolve` path's reminded_count bump for
  `backlog_aging` (lines 438-455) — which feeds `triggers::backlog_aging`'s
  frequency ratchet — is equally untested: a broken bump means a self-promise
  nudges forever at tier 0 or never re-fires.
- **Root cause**: all proactive tests live in the pure-function modules; the
  module that owns the SQL dedupe + status-machine has no test harness. The
  `budget.rs` tests already prove an in-memory pool against `companion_proactive_*`
  tables is feasible — that pattern just wasn't extended here.
- **Impact**: nudge spam (user disables proactivity, the whole feature dies) OR
  silent suppression (Athena looks broken/forgetful) — and a broken backlog
  ratchet that re-pings dropped promises. Core to the product's "reaches out
  thoughtfully, not annoyingly" promise.
- **Fix sketch**: integration tests over an in-memory `UserDbPool` (reuse the
  `budget.rs::test_pool` pattern, but with the *full* `companion_proactive_message`
  schema — see finding #6). Assert: (a) second `enqueue_if_new` with same
  `(kind, ref)` while first is `queued` returns `None`; (b) same after
  `mark_delivered` still returns `None`; (c) after `resolve(..., dismissed)` a new
  enqueue returns `Some`; (d) `trigger_ref = None` dedupes against another `None`
  of the same kind (the COALESCE invariant); (e) `resolve(engaged)` on a
  `backlog_aging` row increments `companion_backlog_item.reminded_count` by
  exactly 1, and `resolve(dismissed)` does NOT; (f) `resolve` on an
  already-resolved id returns the `not found or already resolved` error.

## 2. Wake gate (`wake_window::gate`) decides autonomy and is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/wake_window.rs:53-72 (`gate`), :17 (`QUEUE_CAP`)
- **Current test state**: none
- **Scenario**: `gate` is the single shared decision for whether *any* of Athena's
  autonomous CLI surfaces (exec triage, message triage, channel reactions) may
  process. Its precedence is load-bearing and subtle: `pending == 0 → waiting`,
  then `window == 0 → reactive` (legacy bypass), then `has_priority → priority`
  (human-blocking signals must NOT wait out the window), then
  `pending >= QUEUE_CAP → queue_size`, then the time-since-last-wake check. A
  regression that reorders these (e.g. checking the window before `has_priority`)
  would make a high/urgent/critical message wait out the full window — Athena
  goes silent on exactly the signals she must act on fast. Conversely, dropping
  the `window == 0` short-circuit would silence the legacy reactive install.
- **Root cause**: pure-ish function (only `minutes_since_last_wake` touches the
  DB) but never given a test module; the priority-ordering contract is described
  only in the doc comment, enforced nowhere.
- **Impact**: either missed urgent autonomous responses (priority starvation) or
  runaway waking (token burn). This gate governs the whole autonomy-impact ledger.
- **Fix sketch**: extract the precedence into a testable shape or feed an
  in-memory pool with a seeded `athena_wake_log`. Table-driven test asserting
  each `reason` for: pending=0; window=0+pending>0; window>0+has_priority
  (priority beats window even when last wake is recent); pending>=QUEUE_CAP (25)
  beats a not-yet-due window; first-wake-ever (`None`) is due with reason
  `window`; age >= window → due; age < window → waiting. Also assert the
  boundary `pending == QUEUE_CAP` (>= not >) and `age == window` (>= not >).

## 3. `projects::register` upsert-on-path + auto-subscription untested (id mismatch risk)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/projects.rs:83-126 (`register`), :128-138 (`record_scan`)
- **Current test state**: none
- **Scenario**: `register` does `ON CONFLICT(path) DO UPDATE` then re-reads the id
  by path (because the conflicting row keeps its *original* id, not the freshly
  generated one). The auto-created `dev_tools_project_subscription` uses that
  `final_id` with `INSERT OR IGNORE` so re-registering doesn't clobber watch
  flags. This is fiddly: if the re-read-by-path step were dropped, callers would
  get a phantom id that doesn't exist in the table, and `record_scan(id, ...)`
  (which matches on `id`, not `path`) would silently update 0 rows — scans would
  appear to run but never persist `last_scan_at`. Empty-name/empty-path
  validation (lines 89-94) also guards a write and is unverified.
- **Root cause**: registry treated as "small surface, nothing heavy" per the
  module doc — but the upsert id-resolution and the cross-table subscription
  insert are precisely where silent data-correctness bugs hide.
- **Impact**: a renamed/re-registered project tracked under a wrong id → scans
  recorded against nothing, or a subscription's user-set watch flags wiped on
  re-register. Project tracking quietly stops working.
- **Fix sketch**: in-memory pool with `companion_known_project` (UNIQUE path) +
  `dev_tools_project_subscription`. Assert: register returns a usable id that
  `get` resolves; re-register same path with a new name updates name/description
  and returns the SAME id; re-register does NOT reset an existing subscription's
  `watch_obsidian`/`enabled` (INSERT OR IGNORE); `record_scan(returned_id, ...)`
  updates exactly 1 row; empty name and empty path both return the validation
  error and write nothing.

## 4. Scheduled-checkin budget sharing (`deliver_due_scheduled`) untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/proactive/mod.rs:218-243 (`insert_scheduled`), :260-311 (`deliver_due_scheduled`)
- **Current test state**: none
- **Scenario**: Athena's `schedule_proactive` commitments are held `queued` with a
  `scheduled_for` timestamp and released by a time-based sweep that *shares the
  same global daily budget* as the trigger path — the doc comment (lines 245-259)
  explicitly states the two paths "can't jointly exceed the cap." That invariant
  is enforced only by re-reading `budget::today` and per-row `try_consume`, with
  oldest-first ordering so overflow stays queued for the next tick. If a
  regression released due rows *without* consuming budget, or processed
  newest-first, the two paths could blow past the global cap of 12 (spam) or the
  wrong commitments would win the remaining budget.
- **Root cause**: the sweep + budget interaction is integration-shaped (needs
  rows with timestamps + a budget table) and wasn't covered when `budget.rs`'s own
  unit tests were written.
- **Impact**: scheduled check-ins jointly exceed the daily cap (the exact
  spam-prevention the budget exists for) or fire out of commitment order.
- **Fix sketch**: seed `companion_proactive_message` with several `scheduled_for`
  rows (some past-due, some future) and a near-exhausted
  `companion_proactive_budget`. Assert: only `scheduled_for <= now` rows are
  returned; they come oldest-first; the count released never exceeds remaining
  global budget; overflow rows stay `queued` (not mutated); future-dated rows are
  untouched. Pair with a combined assertion that
  `evaluate_with_extra_candidates` + `deliver_due_scheduled` in one pass cannot
  exceed `GLOBAL_DAILY_CAP`.

## 5. `dev_goal_nudges` business logic (overdue/due/stalled) untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/proactive/triggers.rs:210-267 (`dev_goal_nudges`)
- **Current test state**: none (the surrounding `triggers.rs` is otherwise well-tested)
- **Scenario**: this fn drives the project-goal nudges (target-approaching/overdue
  vs stalled) and carries non-trivial branching that maps to user-facing copy:
  "due today" (days==0), "was due N day(s) ago" (days<0), "is due in N day(s)"
  (0<days<=3), and the stall path (status in in-progress/blocked, progress<100,
  untouched >=7 days). It also encodes a priority rule — target-approaching wins
  over stall for the same goal (the `continue`). A boundary slip (`<=` vs `<` on
  `DEV_GOAL_TARGET_LOOKAHEAD_DAYS`, or excluding `completed`/`done`) would either
  pester the user about finished goals or miss a real deadline. Unlike the
  date-parse and humanize helpers, this whole evaluator has no coverage.
- **Root cause**: it takes the *main* `sys_db` pool (dev_goals don't live in the
  companion user_db), so it needs a different fixture than the rest of the
  module's user_db tests — friction that left it skipped.
- **Impact**: wrong/late deadline nudges or nudges about already-done goals →
  erodes trust in the proactive surface.
- **Fix sketch**: this is largely **llm-generatable** once a small `dev_goals`
  fixture exists. Invariant to assert (not snapshot the copy): a goal with
  `status in {done, completed}` produces NO nudge regardless of dates; a goal due
  in 0/1/3 days produces exactly one `dev_goal_target` nudge and `>3` days does
  not; an overdue goal produces a `dev_goal_target` (not stalled); a tracked
  in-progress goal at <100% untouched >=7 days produces `dev_goal_stalled`; and a
  goal that is BOTH due-soon and stale produces only the target nudge (priority).

## 6. `budget.rs` test schema drifts from production table
- **Severity**: medium
- **Category**: test-structure
- **File**: src-tauri/src/companion/proactive/budget.rs:257-279 (`test_pool`); cf. prod schema src-tauri/src/db/mod.rs:716 + ALTER at :389
- **Current test state**: exists-but-weak
- **Scenario**: the in-memory `test_pool` creates `companion_proactive_message`
  with only `(id, trigger_kind, status, created_at)`. Production has
  `trigger_ref, message, delivered_at, resolved_at, scheduled_for` and a later
  `ALTER TABLE ... ADD COLUMN scheduled_for`. The budget tests pass because they
  only touch the columns they declared — but this divergent mini-schema is
  copy-pasted risk: any future test in this module that exercises dedupe or the
  scheduled sweep against this fixture would silently miss columns, and a real
  `SELECT ... scheduled_for` against the test table would error or behave
  differently than prod. The fixture also can't catch a schema/code mismatch
  because it isn't derived from the real DDL.
- **Root cause**: hand-rolled minimal DDL per test module instead of a shared
  fixture sourced from the canonical migration/schema.
- **Impact**: tests green while prod schema assumptions are wrong; new tests
  built on this fixture inherit blind spots (directly enables findings #1 and #4
  to be written incorrectly).
- **Fix sketch**: introduce one shared test-DB helper (under `#[cfg(test)]`) that
  builds the companion proactive tables from the *same* column list prod uses
  (or applies the relevant migration slice), and have budget/dedupe/scheduled
  tests share it. Assert the fixture includes `scheduled_for`, `trigger_ref`,
  `delivered_at`, `resolved_at` so it stays in lockstep with `mod.rs` row reads.

## 7. `parseBrainLinks` length-desc ordering + scoping invariant
- **Severity**: low
- **Category**: missing-assertion
- **File**: src/features/plugins/companion/parseBrainLinks.ts:37-66; test at src/features/plugins/companion/__tests__/parseBrainLinks.test.ts
- **Current test state**: exists-but-weak (verify coverage of the two stated invariants)
- **Scenario**: the parser has two explicit contracts in its doc: (a)
  `KIND_TOKENS` is ordered length-desc so the regex matches
  `design_decision_x` before the shorter `decision`/`reflection` prefixes, and
  (b) non-brain tokens (`op_abc12`, `sess_aabbccdd`, arbitrary `word_word`) are
  NOT matched. If the existing test doesn't pin both, a future reorder of
  `KIND_TOKENS` or a regex tweak could mis-tokenize a `design_decision_*` id as
  a different kind (wrong chip → wrong navigation / 404), silently.
- **Root cause**: existing test may cover the happy path (some links found) but
  not the alternation-ordering edge or the negative scoping cases.
- **Impact**: a brain-link chip routes to the wrong memory kind or leaks
  non-brain tokens as chips — minor UX bug, low blast radius.
- **Fix sketch**: **llm-generatable** additions to the existing spec. Assert:
  `design_decision_abc` parses as kind `design_decision` (not `decision`/other);
  `op_abc12` and `sess_xx` yield zero links; duplicate ids dedupe to one entry
  preserving first-occurrence order; mixed content returns links in document
  order. Invariant: every returned `kind` is one of `KIND_TOKENS`.
