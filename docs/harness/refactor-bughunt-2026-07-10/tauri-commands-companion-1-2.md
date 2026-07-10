> Context: tauri:commands/companion [1/2]
> Total: 9
> Critical: 0  High: 0  Medium: 4  Low: 5

## 1. `gather_fleet_digest` mixes RFC3339 storage with SQLite `datetime('now')` in the window filter
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/companion/approvals.rs:1704-1719 (also directive builders that consume the digest)
- **Scenario**: `gather_fleet_digest` filters `persona_executions` with `WHERE ... created_at >= datetime('now', ?1)`. `persona_executions.created_at` is written as `chrono::Utc::now().to_rfc3339()` (confirmed in db/repos/execution/executions.rs:447/680/…), i.e. `"2026-07-10T09:00:00.123+00:00"`, while `datetime('now','-14 days')` yields `"2026-06-26 12:34:56"` (space, no `T`, no offset). String comparison of the two differs at the date/time separator: for any row on the boundary day, `'T'`(0x54) > `' '`(0x20), so **every** boundary-day execution is included regardless of the actual cutoff time — the "last N days" window over-includes a partial day, and the value/failure/cost numbers Athena reasons and acts on are subtly wrong.
- **Root cause**: The author already knows this trap — the sibling `gather_daily_brief_digest` (same file, lines 2139-2151) deliberately switched to `julianday('now') - julianday(created_at) <= ?1` "because the `T`/`Z` break ordering". That fix was never applied to `gather_fleet_digest`, which queries the same operational DB.
- **Impact**: UX / incorrect analytics feeding autonomous steering decisions (fleet-analysis note, proposed `update_dev_goal`).
- **Fix sketch**: Use the same `julianday('now') - julianday(created_at) <= win_days` predicate `gather_daily_brief_digest` uses (pass `days` as fractional days), or normalize both sides to one format.

## 2. `fleet_broadcast` de-dupes targets without sorting → duplicate PTY writes
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/companion/approvals.rs:3744-3769
- **Scenario**: For `target="ids"`, the ids come straight from Athena's params array, then `targets.dedup()` runs. `Vec::dedup()` only collapses **consecutive** equal elements. If Athena emits `ids: ["a","b","a"]` (a plausible model slip), the non-adjacent `"a"` survives and the broadcast text is written into session `a`'s PTY **twice** — a doubled keystroke/instruction into a live agent terminal. The success message also miscounts the total.
- **Root cause**: `dedup()` used as if it were set-uniqueness; no prior sort or `HashSet`.
- **Impact**: Duplicate input injected into a running CLI session (garbled command / repeated turn).
- **Fix sketch**: Replace `targets.dedup()` with a set-based unique (e.g. collect through a `BTreeSet`/`HashSet`, or `sort()` then `dedup()`), preserving first-seen order if desired.

## 3. `reconcile_if_dispatched` can write two wrap-up episodes under the documented double-fire
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/commands/companion/fleet_bridge.rs:824-951
- **Scenario**: The function is explicitly called from two paths (the Rust PTY reaper via `reconcile_if_dispatched_public`, and the JS bridge) and comments note both can fire on one exit. Idempotency rests on `if op.completion_summary.is_some() { return; }` (line 845) followed by `synthesize_operation_summary` (line 849). Nothing serializes the check against the set, so two concurrent invocations both observe `None`, both synthesize, and both `append_episode(...)` the op wrap-up (lines 863-870). The `(trigger_kind, trigger_ref)` dedupe on `enqueue_external` protects only the proactive **card**, not the episode append — so the episodic transcript gets duplicate "operation X wrapped" system episodes.
- **Root cause**: Check-then-act on `completion_summary` is not atomic; the dedupe guard covers a different side-effect than the episode write.
- **Impact**: Data/UX — duplicate wrap-up episodes pollute recall + the brain viewer; minor but real.
- **Fix sketch**: Make `synthesize_operation_summary` return `Some` only for the winning caller (compare-and-set on the summary field inside operative memory), and gate the episode append + emit on that boolean rather than on a pre-read snapshot.

## 4. `companion_pin_widget_to_cockpit` load-modify-save is not atomic (lost update)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src-tauri/src/commands/companion/consolidate.rs:348-435
- **Scenario**: The command `load_cockpit` → mutate the parsed spec in memory → `save_cockpit` (full-spec overwrite) with no transaction or version check. If a user pin and an Athena `compose_cockpit` (or two rapid pins) interleave, the second save clobbers the first's widget — exactly the "Athena's next compose would silently evict the user's intent" failure the promotion logic tries to prevent, but reintroduced at the store level.
- **Root cause**: Read-modify-write over a serialized JSON blob without optimistic concurrency.
- **Impact**: UX — occasionally dropped cockpit widget; low likelihood (single window).
- **Fix sketch**: Wrap load+save in one write transaction, or add a spec version/updated_at guard to `save_cockpit` and retry on mismatch.

## 5. `auto_resolve_if_allowed` returns `Ok(false)` after finalizing `approved_failed`
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src-tauri/src/commands/companion/approvals.rs:509-519
- **Scenario**: After `load_pending` atomically moves the row `pending → running`, the belt-and-suspenders re-check `if !AUTOAPPROVE_ALLOWLIST.contains(&action)` calls `finalize_approval(..., APPROVED_FAILED)` and then `return Ok(false)`. Per the documented caller contract, `Ok(false)` means "left pending for the user" — but the row is now terminal (`approved_failed`), so a caller that surfaces it as a still-pending orb consult would present a dead approval.
- **Root cause**: The `Ok(false)` sentinel conflates "not auto-resolved, still pending" with "auto-resolved to failure"; the early-return picks the wrong one.
- **Impact**: Contract/state inconsistency; author notes the branch is "unreachable in practice" (payload + action written together), so impact is bounded.
- **Fix sketch**: Return `Ok(true)` on this path (it *did* resolve, to failure), or leave the row in `running`/re-open it if the intent is genuinely "defer to user".

## 6. Dev-project resolution block copy-pasted across 5 executors
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/companion/approvals.rs:1507-1538, 1579-1610, 3112-3150, 3216-3259, and (variant) 1938-2001
- **Scenario**: The "resolve a `dev_projects` row from id / name / slash-normalized `root_path`, with a most-recently-created fallback, else a Validation error" logic is duplicated near-verbatim in `execute_scan_kpis`, `execute_propose_kpi`, `execute_open_test_env`, `execute_enqueue_dev_job`, and in a lightly-varied form in `execute_run_browser_test`. Each carries the same `replace(root_path,'\\','/')` normalization and the same fallback SELECT. Verified by reading all five call sites — the SQL and candidate-collection are effectively identical.
- **Root cause**: Organic growth — each new Athena op that targets a project re-implemented resolution instead of sharing one.
- **Impact**: Maintainability — a fix to matching rules (e.g. the path-normalization the code repeatedly re-derives) must be made in 4-5 places; drift risk (the browser-test variant already differs).
- **Fix sketch**: Extract `fn resolve_dev_project_id(conn/&DbPool, candidates: &[String]) -> Result<String, AppError>` (and a thin `resolve_from_params` collecting the id/name/path/`params.*` keys), then call it from all five.

## 7. `sources: Vec<String>` param extraction duplicated in every memory-write executor
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/companion/approvals.rs:1071-1079, 1179-1187, 1268-1276, 2423-2431
- **Scenario**: The identical `params.get("sources").and_then(|v| v.as_array()).map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()` block appears in `execute_write_fact`, `execute_write_procedural`, `execute_write_goal`, and `execute_write_ritual` (some then re-implement the "must be non-empty" check).
- **Root cause**: No shared param-extraction helper.
- **Impact**: Maintainability only.
- **Fix sketch**: Add `fn string_array(params: &Value, key: &str) -> Vec<String>` (and optionally `fn require_string_array`) and reuse.

## 8. Char-truncate-with-ellipsis reimplemented ~7 times
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: approvals.rs:1135-1140, 2588-2597, 3340-3344, 975-981; brain.rs:994-999; templates.rs:68-73; fleet_bridge.rs:970-981
- **Scenario**: The pattern "take first N `chars()`, append `…` when longer" is hand-rolled in the fact preview, `derive_build_name`, `schedule_proactive` preview, `format_proactive_wrap_up` headline, design-decision preview, template snippet, and the wrap-up headline — each with slightly different N and off-by-one handling (`take(199)` vs `take(200)` vs `take(N)`).
- **Root cause**: No shared truncation util in this command layer.
- **Impact**: Maintainability / minor inconsistency in ellipsis boundary.
- **Fix sketch**: One `fn truncate_chars(s: &str, max: usize) -> String` (ellipsis when `chars().count() > max`) used everywhere.

## 9. User's first name "Michal" hardcoded into runtime directives and correction notes
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: brain.rs:238-239, 260, 254; fleet_bridge.rs:732-746 ("Tell Michal…", "Review this honestly for Michal…")
- **Scenario**: `companion_correct_identity_claim` writes `"[identity correction] Michal marked a claim wrong…"` and the removal rationale `"Michal marked this claim about himself as wrong"`; the dev-mode reflection directive hardcodes "Michal" twice. The identity/name should come from the identity.md profile the app already maintains, not a string literal — verified these are literal `"Michal"` tokens, not variables.
- **Root cause**: Personal name baked into prompt/note text instead of sourced from identity.
- **Impact**: Maintainability / correctness if the profile owner ever differs; couples backend copy to one user.
- **Fix sketch**: Read the user's display name from identity/settings (fallback "you"/"the user") and interpolate, or drop the name from these internal-only notes.
