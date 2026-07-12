> Context: tauri:commands/infrastructure [1/3]
> Total: 10
> Critical: 0  High: 1  Medium: 5  Low: 4

## 1. Offline session breaks when a prior access token is still present
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/infrastructure/auth.rs:728-745 (with 91-101)
- **Scenario**: A user is signed in (`auth.access_token = Some`, valid). The proactive `spawn_session_refresh_loop` fires near expiry, or the user calls `refresh_session`, and the network is momentarily down. `do_token_refresh` hits the `AppError::NetworkOffline` branch, which sets `auth.user` + `auth.is_offline = true` but does NOT clear `auth.access_token`. `to_response()` computes `offline_authed = is_offline && user.is_some() && access_token.is_none()` — that's `false` because the (soon-to-expire) token is still `Some`. `token_valid` is `access_token.is_some() && !is_token_expired()`; once the old token expires (within the 5-min refresh lead window) `token_valid` is also `false`. Result: `is_authenticated = false` — the user is bounced to the login screen mid-session despite having a valid cached profile.
- **Root cause**: `to_response`'s offline branch is gated on `access_token.is_none()` (matching the startup `try_restore_session` path where the token is `None`), but `do_token_refresh`'s offline branch leaves a stale token in place, so the two offline entry points disagree on the invariant.
- **Impact**: UX / spurious logout — offline mode is effectively non-functional for the refresh path (only startup restore works).
- **Fix sketch**: In the `NetworkOffline` branch of `do_token_refresh`, set `auth.access_token = None` (and `auth.token_expires_at = None`) before `to_response()`, mirroring `try_restore_session`. Or relax `offline_authed` to not require `access_token.is_none()`.

## 2. Cancelled / failed Google OAuth leaves pending_oauth_state set, blocking all future logins
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src-tauri/src/commands/infrastructure/auth.rs:388-489 (also 497-590)
- **Scenario**: `login_with_google` sets `auth.pending_oauth_state = Some(nonce)` (lines 413-416) and then opens a `closable(true)` OAuth webview. If the user closes the popup without completing sign-in, or `WebviewWindowBuilder::build()` fails after the nonce is stored, nothing ever clears `pending_oauth_state`. Every subsequent `login_with_google` / `login_with_google_drive` returns `Err("An OAuth sign-in is already in progress")` (lines 399-405) until the app is restarted or `clear_pending_oauth` is manually invoked.
- **Root cause**: The nonce is a one-shot guard set before a fallible/abandonable UI step, with cleanup only on the happy-path callback (`.take()` in `handle_auth_callback`). Window-close and build-failure paths have no compensating reset.
- **Impact**: UX — a user who cancels one sign-in can't retry; looks like a hard failure.
- **Fix sketch**: Clear `pending_oauth_state` on the window's close event (`on_window_event`/`WindowEvent::CloseRequested`) and in the `build().map_err(...)` path; or store the nonce with a timestamp and treat an old pending state as expired in the guard check.

## 3. Dev-server registry never detects dead processes; kills by stale PID
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:1013-1151 (DEV_SERVERS at 962-964)
- **Scenario**: `dev_tools_start_slot_server` spawns the dev server, stores `(pid, port)` in the global `DEV_SERVERS` map, and drops the `Child` handle. If that process later crashes or the app is restarted while the row lingers, `dev_tools_start_slot_server` short-circuits with `"already_running"` (lines 1021-1031) forever — the slot can never be restarted. On stop, `dev_tools_stop_slot_server` runs `taskkill /F /T /PID <pid>` (Windows) / `kill -9 <pid>` against the stored PID with no liveness/identity check; after the original process exits the OS may reuse that PID, so the kill can terminate an unrelated process.
- **Root cause**: Raw PID stored as the sole liveness signal; no `Child` retained to `try_wait()`, and no verification the PID still maps to the spawned server before killing.
- **Impact**: UX (stuck "already_running") + potential wrong-process kill.
- **Fix sketch**: Store the `Child` (or a `try_wait()`-capable handle) and probe it before the "already_running" return and before killing; drop the entry when the child has exited. At minimum record spawn time and skip kill if the process is gone.

## 4. Triage-rule auto-decisions skip the learning loop and drop the rejection reason
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/infrastructure/dev_tools.rs:1489-1554
- **Scenario**: `dev_tools_run_triage_rules` flips matching pending ideas to `accepted`/`rejected` via `repo::update_idea` but (a) never calls `record_idea_decision(...)`, which the manual `dev_tools_accept_idea`/`dev_tools_reject_idea` (lines 1134-1162) and the strategist path (`idea_scanner::apply_triage_decision`) both use to write the shared team-memory constraint, and (b) passes `None` for `rejection_reason`. Because a future `dev_tools_run_scan` suppresses re-surfacing by feeding back rejected-idea titles/team-memory constraints, an idea auto-rejected by a triage rule leaves no memory trail and no reason — the next scan can re-propose the same idea the rule was created to kill.
- **Root cause**: Three triage entry points (manual inbox, strategist job, rule engine) implement the persist+learn step inconsistently; the rule engine only does the status write.
- **Impact**: data/UX — auto-triaged ideas re-surface; team ledger loses the decision; rejection reasons are lost.
- **Fix sketch**: After the status flip, look up the updated idea and call `record_idea_decision_by(&state.db, &idea, new_status, "TriageRule")`; pass a synthesized reason (e.g. the rule name) into the `rejected` update.

## 5. Idea-scan idea_count conflates ideas, triage decisions, and goal relations
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/commands/infrastructure/idea_scanner.rs:766-824, 909-915
- **Scenario**: `run_idea_scan` increments `ideas_created` for created ideas (767), applied triage decisions (801), and applied goal relations (817). The same counter is returned and written to `dev_scans.idea_count` via `update_scan(... Some(idea_count) ...)` for both the normal scan (`run_scan_core`) and the backlog-triage run (`run_backlog_triage`). For a triage run the field is repurposed to mean "decisions", and for a normal scan any incidental `triage`/`relate_goals` protocol lines inflate the reported idea count. The partial-success-on-timeout path (859) also keys on this mixed number.
- **Root cause**: One counter reused for three semantically different protocol outcomes.
- **Impact**: UX/metrics — `idea_count` and completion toasts over/mis-report.
- **Fix sketch**: Track `ideas_created`, `triage_decisions`, `relations_created` separately; return the relevant one per caller (ideas for scans, decisions for triage).

## 6. Claude-CLI spawn / stream / timeout / stderr-ring boilerplate duplicated across four commands
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/infrastructure/task_executor.rs:656-929; context_generation.rs:703-1082; idea_scanner.rs:615-916; twin.rs:658-749
- **Scenario**: Each of `run_task_execution`, `run_context_generation`, `run_idea_scan`, and `twin_generate_bio`/`spawn_claude_with_prompt` re-implements the identical envelope: `prompt::build_cli_args`, push `--model claude-sonnet-4-6`, `kill_on_drop(true)`, piped stdio, `#[cfg(windows)] creation_flags(0x08000000)`, `env_removals`/`env_overrides`, spawn with the same `ErrorKind::NotFound → "Claude CLI not found…"` mapping, a spawned stdin-writer task, a bounded stderr ring + tee, a `tokio::time::timeout` stdout line loop calling `extract_display_text` + `parse_stream_line`, and a kill-on-timeout/reap. The subtle behaviors (kill-then-bounded-wait on timeout) have already drifted between copies (task_executor added the bounded reap; context_generation kills but then does an unconditional 5s wait).
- **Root cause**: The CLI-run pattern was copy-adapted per feature instead of extracted; drift is now accumulating in the divergent timeout/reap handling.
- **Impact**: maintainability — a fix (e.g. the zombie-reap improvement) must be applied in 3-4 places; behaviors silently diverge.
- **Fix sketch**: Extract a `run_headless_claude(cli_args, prompt, timeout, cwd, on_line)` helper (in `engine::cli_process`) that owns spawn+stdin+stderr-ring+timeout+reap and yields parsed stdout lines to a per-caller closure; migrate the four sites.

## 7. Competition slot lookup + row mapping + empty-diff disqualify block repeated inline
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:401-504, 629-645, 1034-1045; 302-332 vs 450-475
- **Scenario**: `SELECT ... FROM dev_competition_slots WHERE id = ?1` is hand-written at four call sites (`dev_tools_refresh_competition_slot` maps the full 14-field `DevCompetitionSlot` by hand; `get_competition_slot_diff`, `switch_to_worktree`, and `start_slot_server` each re-select `worktree_name, competition_id`), while every other slot access goes through the `repo` layer. The compute-diff → stats_json → empty-diff `(dq, reason)` disqualify block is also duplicated verbatim between `dev_tools_get_competition` (302-332) and `dev_tools_refresh_competition_slot` (450-475).
- **Root cause**: No `repo::get_competition_slot_by_id` accessor, and the diff-analysis persistence step wasn't factored into a shared helper.
- **Impact**: maintainability — a schema change to `dev_competition_slots` or a change to the empty-diff rule must be edited in several places; the hand-mapping is a bug magnet.
- **Fix sketch**: Add `repo::get_competition_slot_by_id`; extract `analyze_slot_diff(pool, root, slot) -> DevCompetitionSlot` and call it from both `get_competition` and `refresh_competition_slot`.

## 8. Stale `#[allow(dead_code)]` on an actively-used protocol variant
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/commands/infrastructure/context_generation.rs:268-274
- **Scenario**: `ContextMapProtocol::Update { .. }` carries `#[allow(dead_code)]`, but the variant is both constructed (`parse_context_map_protocol`, line 361) and matched (`run_context_generation` stream loop, line 1033). Verified by grepping both the parse and match sites in the same file. The attribute is therefore obsolete and — worse — it would suppress a genuine dead-code warning if a future edit ever stops constructing/handling the variant.
- **Root cause**: Attribute left behind from when the variant was parsed-but-not-yet-handled.
- **Impact**: maintainability — dead-code lint blind spot.
- **Fix sketch**: Delete the `#[allow(dead_code)]` on the `Update` variant.

## 9. dev_tools.rs remains an oversized god-module
- **Lens**: code-refactor
- **Severity**: low
- **Category**: oversized-module
- **File**: src-tauri/src/commands/infrastructure/dev_tools.rs:1-3483
- **Scenario**: The 2026-05-10 split extracted only competitions/triage/workspace into submodules (see header, lines 4-12); the file still holds the full CRUD + business logic for projects, active-project session state, goals, goal dependencies/signals/items, the UAT gate, context groups, contexts, context-group relationships, ideas, scans, tasks, triage rules, and pipelines — 3483 lines in one flat file.
- **Root cause**: Incremental extraction stopped after the competition carve-out.
- **Impact**: maintainability / navigation cost; large-blast merge conflicts.
- **Fix sketch**: Continue the established `mod` split — e.g. `goals.rs` (goals + deps + signals + items + UAT), `contexts.rs` (groups + contexts + relationships), `ideas.rs`, `pipelines.rs` — re-exported via `pub use` exactly like `competitions::*`.

## 10. Twin answer/reply prompt builders duplicate the block-assembly scaffolding
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/infrastructure/twin.rs:888-1044
- **Scenario**: `build_reply_prompt` and `build_answer_prompt` (and, partially, `build_questions_prompt`) each independently build the same optional blocks with the same filter-empty-then-format idiom: `role_part`, `bio_block`, `tone_block` (voice_directives + length_hint), `facts_block`, and `directions_block`. Only the final `format!` template and the framing differ.
- **Root cause**: Two sibling prompt builders authored by copy-and-adapt.
- **Impact**: maintainability — a change to how tone/facts are rendered (e.g. truncation, ordering) must be mirrored in both.
- **Fix sketch**: Extract small helpers (`role_suffix`, `bio_block`, `tone_block`, `facts_block`, `directions_block`) shared by both builders; keep only the per-mode template in each function.
