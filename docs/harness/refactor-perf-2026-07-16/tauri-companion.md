# tauri:companion — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 3 medium / 2 low)
> Context group: Plugins & Companion | Files read: 15 | Missing: 0

## 1. Whole-function `#[cfg(feature = "ml")]` / `#[cfg(not(...))]` body duplication, already drifting
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/dev_session.rs:111 (also 186, 254, 318; src-tauri/src/companion/prompt.rs:147 and 283)
- **Scenario**: Any fix to the improvement pipeline or the prompt builder must be applied twice, once per feature-gated variant. The variants have already drifted: the non-ml `run_improvement` (line 217) silently swallows the stdin write error and the timeout warn that the ml variant logs (lines 150, 162), and the non-ml `recover_orphan_improvements` is a near-verbatim 55-line copy of the ml one minus the embed call.
- **Root cause**: The only real difference between each pair is "embed the episode or not", but the split was made at the function boundary instead of at the single call site that differs. `prompt.rs::build_system_prompt` duplicates ~100 lines (observability digest, addenda assembly, plugins/connectors formatting) for the same reason — only the `Recall` construction and synthesis block differ.
- **Impact**: ~250 duplicated lines across two files on a hot, frequently-edited surface; every future change risks landing in one variant only (one behavioral divergence has already happened). Cross-feature builds (`--features desktop` vs `desktop,ml`) can behave differently in ways nobody intended.
- **Fix sketch**: Extract the shared body into one private function taking an `Option<&Arc<EmbeddingManager>>`-shaped seam behind a tiny cfg-gated type alias (the codebase already does this pattern in `athena_reaction::embedding_manager_of`). For `prompt.rs`, keep one `build_system_prompt` body and cfg-gate only the `let recall = ...` and `let briefing = ...` expressions. `log_outcome_episode` already abstracts the embed-or-not choice — route both recover variants through it.

## 2. Triplicated marker-envelope JSON extraction in athena_reaction.rs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/athena_reaction.rs:593 (also 618, 1411)
- **Scenario**: `parse_athena_decision`, `parse_athena_batch`, and `parse_athena_review` are three byte-identical copies of the same algorithm (scan for `"<marker>"`, `rfind('{')`, `match_braces`, deserialize, last occurrence wins) differing only in the marker string and the envelope type. A fourth protocol (there is already talk of more headless legs in the module docs) will clone it again.
- **Root cause**: The extraction loop was copy-pasted per protocol instead of being written once generically over `T: Deserialize` + marker.
- **Impact**: ~60 duplicated lines; any tolerance fix (e.g. handling a marker inside a code fence, or a different brace-matching edge) must be applied three times, and the existing tests only cover two of the three copies for the shared edge cases.
- **Fix sketch**: `fn parse_envelope<T: serde::de::DeserializeOwned>(blob: &str, marker: &str) -> Option<T>` containing the loop; the three public parsers become one-liners (`parse_envelope::<AthenaChannelEnvelope>(blob, "\"athena_channel\"").map(|e| e.athena_channel)`). Existing tests keep passing unchanged.

## 3. Per-conversation COUNT(*) correlated subqueries run on every chat turn for a digest that only needs a boolean
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/companion/conversation.rs:56 (used via roster_digest_for_prompt:189, called from prompt.rs:181/316)
- **Scenario**: Every `send_turn` builds the system prompt, which calls `roster_digest_for_prompt` → `list_active`, whose `SELECT_COLS` computes TWO correlated `COUNT(*)` subqueries over `companion_node` per conversation row (`message_count`, `unread_count`). Episodes grow without bound (every user/assistant/system/PROGRESS message is a row), so this cost grows with total transcript size, per conversation, per turn.
- **Root cause**: The digest reuses the full UI-shaped `ConversationRow` (which needs the counts for badges) when all it actually consumes is `title`, `last_active_at`, and `unread_count > 0` for at most 6 rows.
- **Impact**: 2×N `companion_node` aggregate scans on the hottest path in the module (prompt build precedes every CLI spawn — chat, autonomous ticks, proactive turns). With a long-lived install (tens of thousands of episodes across several threads) this becomes measurable latency added before every single turn; `message_count` is computed and then thrown away entirely.
- **Fix sketch**: Give the digest its own slim query: `SELECT id, title, last_active_at, EXISTS(SELECT 1 FROM companion_node n WHERE n.kind='episode' AND n.session_id=s.id AND n.created_at > COALESCE(s.last_read_at,'')) FROM companion_session s WHERE status='active' ... LIMIT 7`. `EXISTS` short-circuits where `COUNT(*)` scans; dropping `message_count` halves the remaining work. Verify an index on `companion_node(kind, session_id, created_at)` exists; add one if not.

## 4. N+1 project/goal/KPI queries in the per-turn prompt builder
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/companion/prompt.rs:457 (dev_tools_registry_for_prompt; also format_project_goals:494, format_project_kpis:552)
- **Scenario**: On every turn, three helpers each call `list_projects` and then loop: `dev_tools_registry_for_prompt` issues one `list_scans(..., Some(1))` per project; `format_project_goals` issues one `list_goals_by_project` per project plus one `list_goal_signals(..., Some(1))` per shown goal; `format_project_kpis` issues one `list_kpis` per project. With 12 projects and 6 goals each that is up to ~3 + 12 + 12 + 72 + 12 ≈ 110 separate prepared statements per prompt build.
- **Root cause**: Latest-scan / latest-signal lookups are done as per-row queries inside loops instead of one grouped query (`GROUP BY project_id` with `MAX(created_at)`, or a window-function/`ORDER BY ... LIMIT` join), and `list_projects` itself is executed three times per turn.
- **Impact**: Bounded (caps at 12 shown items) but paid before every chat/autonomous/proactive turn, and it triples the same `list_projects` read. On the user's real multi-project setup this is dozens of avoidable round-trips through the r2d2 pool per turn.
- **Fix sketch**: Fetch `list_projects` once in `build_system_prompt` and pass the Vec to all three formatters. Replace the per-project "latest scan" and per-goal "latest signal" loops with single grouped queries (`SELECT project_id, scan_type, idea_count, MAX(created_at) ... GROUP BY project_id`), keyed into a HashMap before formatting.

## 5. Five copies of the uuid-truncate helper and a duplicated repo-root resolver
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/dispatcher.rs:1987 (also session.rs:2264, dev_session.rs:741, projects.rs:171, turn_ledger.rs:187)
- **Scenario**: `short_random()`/`short_uuid()` — "new v4 uuid, simple, take N chars" — exists five times inside this one context with three different truncation lengths (8/10/12), and `dev_session::resolve_repo_root` (line 683) is a verbatim copy of `dev_mode::repo_root` (line 25).
- **Root cause**: Small helper written inline each time a new module needed an id, never hoisted.
- **Impact**: Pure duplication; the inconsistent lengths are accidental rather than chosen, and the twin repo-root resolvers can drift if the checkout-resolution strategy ever changes (dev_mode's comment even points at dev_session as its mirror).
- **Fix sketch**: Add `crate::utils::ids::short_uuid(n: usize)` (or a const-generic pair) and replace the five copies; have `dev_session::resolve_repo_root` delegate to `dev_mode::repo_root`. Mechanical, no behavior change if each call site keeps its current length.

## 6. Orphan-improvement sweep spawns a `tasklist` subprocess on the chat hot path while a run is in flight
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: resource-management
- **File**: src-tauri/src/companion/dev_session.rs:632 (pid_alive; called from recover_orphan_improvements, invoked in session.rs send_turn:465)
- **Scenario**: `send_turn` calls `recover_orphan_improvements` at the start of every turn. While a self-improve run is in flight (marker present, PID alive — a window of up to 10 minutes by design), every chat/autonomous/proactive turn spawns a full `tasklist /FI ...` subprocess (Windows) just to learn the child is still alive, plus a `read_dir` + marker parse.
- **Root cause**: PID liveness is checked by shelling out per marker per turn instead of using a cheap API (`OpenProcess`/`GetExitCodeProcess` on Windows, `kill(pid,0)` is already used on Unix) or caching the "alive as of <t>" answer for a few seconds.
- **Impact**: `tasklist` typically costs 50–200 ms and a process spawn per turn — bounded and only during the in-flight window, but it is pure waste layered onto every turn's already-long path, and the module is debug-build gated so it only hurts the developer's own hot loop.
- **Fix sketch**: On Windows, replace the `tasklist` shell-out with `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetExitCodeProcess` (or the `sysinfo` crate if already a dependency). Alternatively, short-circuit: skip the whole sweep when the improvements dir has no entries (cache the empty-dir result with a coarse timestamp), which also removes the per-turn `read_dir`.
