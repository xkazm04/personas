# tauri:engine [4/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Regex-anchored role patterns (`if$`, `set$`, `code$`) can never match — dead config that misclassifies nodes
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/platform_rules.rs:108
- **Scenario**: An imported n8n workflow contains an `If`, `Set`, or `Code` node. `classify_node_role` (line 511) matches via `lower.contains(&nrp.pattern.to_lowercase())` — a literal `$` never appears in a node type string, so `nr("if$", "decision")`, `nr("set$", "utility")`, and `nr("code$", "utility")` (lines 108, 113, 115) never fire and these nodes silently fall through to the default `"tool"` role.
- **Root cause**: The patterns were written as regex end-anchors (and `format_node_roles_prompt` even renders them as `/if$/i` regexes at line 423, telling the LLM they are regexes), but the matcher is a plain substring `contains`.
- **Impact**: Three role-classification rules are dead; If/Set/Code nodes classify as `tool` instead of `decision`/`utility`, and the prompt text makes a false claim about regex semantics. Bounded because the roles are advisory hints, but it is config that lies.
- **Fix sketch**: Either strip the `$` and accept substring semantics (with the false-positive cost of matching e.g. "codex"), or implement the intended anchor: when a pattern ends with `$`, match `lower == prefix || lower.ends_with(prefix)` after trimming the `$`. Update `format_node_roles_prompt` to render whatever semantics the code actually implements. Add a unit test asserting `classify_node_role("n8n-nodes-base.if") == "decision"`.

## 2. `invalidate_credential` cache eviction is dead code — its documented caller does not exist
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/resource_listing.rs:169
- **Scenario**: A user edits or deletes a connector credential, then reopens the ResourcePicker within the spec's `cache_ttl_seconds` window (default 600s). The picker serves the stale cached listing fetched with the old credential.
- **Root cause**: `invalidate_credential` carries a doc comment claiming it is "Called on credential delete/edit", but it is marked `#[allow(dead_code)]` — the compiler has proven nothing in the crate calls it. The eviction hook was written but never wired into the credential update/delete command path.
- **Impact**: Dead function plus the behavior gap it was written to close: stale resource picks surfaced for up to 10 minutes after auth fields change (bounded by TTL, and Refresh bypasses it, so Medium not High).
- **Fix sketch**: Wire `invalidate_credential(credential_id)` into the credential update and delete commands (wherever `cred_repo` mutations happen at the IPC layer), then drop the `#[allow(dead_code)]`. If the team decides TTL-only staleness is acceptable, delete the function and fix the comment instead — either way the code should stop claiming a lifecycle that does not exist.

## 3. Empty else-branch in `pattern_matches` app-filter — dead block with a contradictory comment
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/engine/context_rules.rs:264
- **Scenario**: A rule sets `app_filter` and a context event arrives with `app_name: None`. Execution enters an `else` branch whose entire body is a comment plus an `if event.source != "app_focus" { /* nothing */ }` — a no-op — so the event passes the app filter it could not satisfy.
- **Root cause**: A half-finished policy decision left as an empty conditional. The inner comment ("App filter only blocks app_focus events; other sources pass through") describes intent the code does not implement — an `app_focus` event with no `app_name` also passes.
- **Impact**: Maintenance hazard: the block reads as if it does something, and the actual semantics ("no app_name ⇒ filter always passes") are undocumented and probably unintended for app_focus events.
- **Fix sketch**: Decide the semantics and encode them: `None => return event.source != "app_focus"` (filter blocks app-focus events lacking app info, passes other sources), or if pass-through-for-all is intended, delete the empty `if` and leave a one-line comment. Add a test for the `app_filter` + `app_name: None` case, which currently has none.

## 4. Span eviction is O(n) with a full index rebuild — every span start after the 10k cap pays ~10k String clones
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-eviction
- **File**: src-tauri/src/engine/trace.rs:190
- **Scenario**: A long execution (many tool calls / stream-processing spans) crosses `MAX_SPANS` (10,000). From then on, every `start_span` call evicts the oldest completed span via `SpanStore::remove`, which does `Vec::remove(pos)` (shifts up to 10k elements) and then re-inserts an index entry — cloning the `span_id` String — for every element after `pos` (typically pos≈1, i.e. ~10k clones + hashmap writes per span).
- **Root cause**: `SpanStore` pairs a `Vec` with a `HashMap<String, usize>` positional index; removal from the front invalidates every subsequent index entry, and the fix chosen was a full rebuild per removal instead of an order-preserving structure.
- **Impact**: On the hot execution path (span starts happen inside `runner.rs` streaming), a capped trace turns each span start from O(1) into O(MAX_SPANS) with 10k allocations — measurable latency and allocator churn exactly on the runs that are already the heaviest. Bounded (only after the cap) hence Medium.
- **Fix sketch**: Replace eviction-by-shift with a tombstone or generation scheme: mark evicted slots `None` (Vec<Option<TraceSpan>>) and skip them at finalize, or switch the store to an `IndexMap`/`VecDeque` keyed by span_id where pop-front is O(1) and the index maps id → stable key rather than position. Keep the current `end_span` O(1) lookup.

## 5. `composite_tick` re-parses every event timestamp once per trigger — O(triggers × events) RFC3339 parses per tick
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: repeated-parse
- **File**: src-tauri/src/engine/composite.rs:251
- **Scenario**: An install has, say, 10 composite triggers and a busy window near the 5,000-event scan cap. Every tick, the per-trigger windowing loop runs `DateTime::parse_from_rfc3339(&e.created_at)` on all 5,000 events for each of the 10 triggers (50,000 parses), then sorts the filtered slice per trigger — even though the events and their timestamps are identical across triggers.
- **Root cause**: Windowing (`filter` + parse + `sort_by`) lives inside the `for trigger` loop, operating on the shared `recent_events` snapshot instead of a pre-parsed, pre-sorted view built once.
- **Impact**: CPU burned on a recurring background tick scales with triggers × events; string RFC3339 parsing is not cheap, and the per-trigger sort is O(E log E) each. Bounded by the 5,000-event cap, so Medium rather than High.
- **Fix sketch**: Before the trigger loop, map `recent_events` once into `Vec<(DateTime<Utc>, &PersonaEvent)>`, dropping unparseable rows, and sort it once ascending. Per trigger, take the window via `partition_point` (binary search on `window_start`) and pass the resulting slice to the evaluators. Same semantics, one parse pass and one sort per tick.

## 6. Glob pattern recompiled per path per event inside rule evaluation
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: repeated-compile
- **File**: src-tauri/src/engine/context_rules.rs:246
- **Scenario**: A file_watcher burst (e.g. a build touching hundreds of files) streams events through `context_rule_tick`; for each event and each rule with a `path_glob`, `glob::Pattern::new(&pattern.path_glob)` is compiled inside the per-path `.any` closure — pattern compilation runs paths × events × rules times for a string that never changes.
- **Root cause**: `ContextRule` stores the glob as a raw `String` and `pattern_matches` is a stateless static fn, so there is nowhere to hold the compiled `glob::Pattern`.
- **Impact**: Wasted CPU on the ambient-context hot path during file bursts; also a failed compile is silently treated as no-match on every evaluation instead of being rejected once at rule creation. Cost per compile is small, hence Low.
- **Fix sketch**: Compile once per rule: cache `glob::Pattern` in the engine (e.g. `HashMap<String, glob::Pattern>` keyed by rule id, populated in `add_rule` and dropped in `remove_rule`), or hoist `Pattern::new` out of the paths loop as a minimal fix (compile once per event-rule pair). Validate the glob at `add_rule` time and surface the error to the user.
