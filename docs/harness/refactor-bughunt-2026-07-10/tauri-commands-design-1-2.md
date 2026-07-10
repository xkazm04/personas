> Context: tauri:commands/design [1/2]
> Total: 9
> Critical: 0  High: 1  Medium: 4  Low: 4

## 1. Large workflows are silently truncated to 50 KB before the LLM sees them

- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/commands/design/n8n_transform/prompt_sanitizer.rs:23, prompts.rs:307-309,414-424
- **Scenario**: `create_n8n_session` accepts a workflow JSON up to `MAX_WORKFLOW_JSON_BYTES` (5 MB) and `start_n8n_transform_background` accepts a combined `MAX_TRANSFORM_PAYLOAD_BYTES` (10 MB). But `build_n8n_transform_prompt` runs every payload through `sanitize_json_payload`, which calls `truncate_safe(json, MAX_JSON_PAYLOAD)` where `MAX_JSON_PAYLOAD = 50_000` bytes. `build_n8n_unified_prompt` truncates even harder — `truncate_utf8(&sanitized_workflow_json, 5000)` = 5000 chars preview. The n8n_limits module's own docs note realistic exports are "typically under 200 KB", i.e. routinely 4× the sanitizer cap.
- **Root cause**: Two independent size regimes were never reconciled — the intake caps (n8n_limits) are ~100–200× larger than the prompt-embedding cap (prompt_sanitizer). Truncation is silent: no warning is surfaced, no error, no telemetry.
- **Impact**: A user imports a real 150 KB workflow, the app accepts it as valid, then transforms a persona from only the first 50 KB (or 5 KB in the unified path). Tools/triggers/connectors in the tail of the workflow vanish with no signal — the resulting persona looks complete but is missing capabilities. This is exactly the "success theater over a truncated input" failure class.
- **Fix sketch**: Either raise `MAX_JSON_PAYLOAD` to match the intake caps (with a real token budget), or when `json.len() > MAX_JSON_PAYLOAD` emit a `[Milestone]`/warning line and set a flag on the transform result so the UI can tell the user the workflow was too large to fully analyze.

## 2. Byte-index slice on Claude output can panic on multibyte text

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/design/smart_search.rs:341-345
- **Scenario**: When `extract_first_json_object_matching` fails, the error builds `&output_text[..output_text.len().min(500)]`. `output_text` is a UTF-8 `String`; slicing at byte index 500 panics with "byte index 500 is not a char boundary" whenever the 500th byte lands inside a multibyte character (common with any non-ASCII CLI output — accented text, emoji, CJK).
- **Root cause**: Raw byte slicing of a UTF-8 string at an arbitrary index instead of a char-boundary-safe truncation. (The codebase already has `truncate_utf8` for exactly this.)
- **Impact**: The error path — reached precisely when Claude returns malformed output — turns a recoverable "couldn't parse" error into a thread panic inside the Tauri command.
- **Fix sketch**: Replace with `crate::commands::design::n8n_transform::cli_runner::truncate_utf8(output_text, 500)` (already imported in this module's sibling), or `output_text.chars().take(500).collect::<String>()`.

## 3. Design-review run reports "completed" even when every item errored with a question

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/design/reviews.rs:318-357 (contrast 443, 473, 499-508)
- **Scenario**: In `start_design_review_run`, the "Claude asked a question" branch persists a score-0 review and emits per-item status `"error"`, then `continue`s — but it never increments `failed_count`. The other two failure branches (extraction miss at :443, CLI error at :473) do increment it. The run-completion summary at :499 decides `"error"` vs `"completed"` purely from `failed_count`. So a run where every test case asked a clarifying question emits N per-item `"error"` events yet reports a final `"completed"` with no error message.
- **Root cause**: `failed_count` bookkeeping was added to the extraction/CLI branches but the question branch was missed, so its per-item error status and the run-level tally disagree.
- **Impact**: The completion event (green "completed") contradicts the individual rows the user sees as errored — the run-level success theater this counter was added to prevent.
- **Fix sketch**: Increment `failed_count` in the question branch too (or, if a question is deliberately not a failure, emit a non-`"error"` per-item status for consistency).

## 4. Orphaned `staged` import_transactions rows on early-return paths

- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption
- **File**: src-tauri/src/commands/design/n8n_transform/confirmation.rs:56-60,91-96,338,360
- **Scenario**: `create_persona_atomically` inserts an `import_transactions` row with `status='staged'` on the pooled connection (auto-committed, outside the tx). Several later `?` early-returns bypass `record_import_tx_status`: notification-channel encryption failure (:94), `tx.commit()` failure (:338), and the post-commit `persona_repo::get_by_id` (:360). Each leaves the staged row permanently at `'staged'`, never `'rolled_back'`/`'committed'`.
- **Root cause**: The staged row is written unconditionally up front, but only the persona-insert-fail and all-entities-fail paths reconcile its status; the other fallible steps don't.
- **Impact**: Stale `'staged'` rows accumulate. `was_import_rolled_back` only checks for `'rolled_back'`, so a stranded `'staged'` row won't trigger the retry-cleanup path in `confirm_n8n_persona_draft` — a later retry could see an inconsistent staged history.
- **Fix sketch**: Wrap the fallible body so any early `Err` records `'rolled_back'` on the staged row before propagating (or move the staged-row insert into the same tx and rely on rollback).

## 5. Dead promote-helper structs `PromotePreparation` / `PromoteCounters`

- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/commands/design/build_sessions.rs:1072-1090
- **Scenario**: Both structs are declared `#[allow(dead_code)]`. A workspace grep for `PromotePreparation` and `PromoteCounters` finds only these definitions — no constructor, no field access anywhere in `src-tauri/src`. They are leftover scaffolding from a promote refactor that never wired them in.
- **Root cause**: The `#[allow(dead_code)]` masks the fact that the intended consumers were never built (or were replaced by inline logic in `promote_build_draft_inner`).
- **Impact**: Maintainability — future readers assume these types model the promote data flow when nothing uses them.
- **Fix sketch**: Delete both structs and their `#[allow(dead_code)]` attributes; if promote should use them, that's a separate refactor.

## 6. Stale comment claims `seed_mock_manual_review` is "unwired" — it is registered

- **Lens**: code-refactor
- **Severity**: low
- **Category**: doc-rot
- **File**: src-tauri/src/commands/design/reviews.rs:1564-1566 (vs lib.rs:1990)
- **Scenario**: The comment above the `MOCK_*` consts states the seed command is "also unwired in invoke_handler; the cascade flags the constants as unused." But `commands::design::reviews::seed_mock_manual_review` IS present in the `invoke_handler!` list at lib.rs:1990, and the command body uses the consts in debug builds (it's `#[cfg(not(debug_assertions))]`-gated to error in release). So the consts are used in debug, and the command is wired.
- **Root cause**: The comment predates the command being re-registered; the `#[allow(dead_code)]` is only needed for release builds, not because it's "unwired."
- **Impact**: Misleading — a reader following the comment could wrongly delete a live debug command.
- **Fix sketch**: Correct the comment to "used by the debug-only body of `seed_mock_manual_review`; `#[allow(dead_code)]` covers release builds where that body is compiled out."

## 7. Unused `SectionKind::label()` and `SectionValidation::ok()`

- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/commands/design/n8n_transform/streaming.rs:15-39,49-58
- **Scenario**: The `impl SectionKind` block and `impl SectionValidation` are both `#[allow(dead_code)]`. `from_marker` is used (streaming.rs:151), but `SectionKind::label()` has no caller (label strings are built by the separate `build_label` method on the accumulator), and `SectionValidation::ok()` has no caller (validations are constructed inline everywhere).
- **Root cause**: Helper constructors kept "just in case"; the accumulator grew its own labeling/validation and never adopted them.
- **Impact**: Maintainability — duplicated label vocabulary (`label()` vs `build_label`) invites drift.
- **Fix sketch**: Remove `label()` and `ok()`; narrow the `#[allow(dead_code)]` to `from_marker` only if still needed.

## 8. Duplicate UTF-8-safe truncation helpers

- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/design/n8n_transform/cli_runner.rs:863-874, prompt_sanitizer.rs:154-164
- **Scenario**: `truncate_utf8` (cli_runner, returns `&str`) and `truncate_safe` (prompt_sanitizer, returns `String`) implement the identical "walk back to a char boundary at `max` bytes" logic. Both are private/pub within the same `n8n_transform` module tree.
- **Root cause**: Parallel evolution — the sanitizer needed an owned `String`, so a second copy was written instead of `truncate_utf8(...).to_string()`.
- **Impact**: Maintainability — two boundary algorithms to keep correct; a fix to one (e.g. an off-by-one at `max`) won't reach the other.
- **Fix sketch**: Have `truncate_safe` delegate: `truncate_utf8(s, max).to_string()`, and drop its duplicated loop.

## 9. Two near-identical balanced-delimiter JSON scanners

- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/design/n8n_transform/cli_runner.rs:885-966,1000-1047
- **Scenario**: `extract_first_json_object_matching` (walks `{`/`}`) and `extract_questions_output` (walks `[`/`]`) both carry the same hand-rolled `in_string`/`escape_next`/`depth` state machine to find a balanced delimiter span; `streaming.rs::extract_json` also leans on the first. Only the open/close byte and the marker prefix differ.
- **Root cause**: The bracket scanner was copied from the brace scanner and specialized rather than parameterized.
- **Impact**: Maintainability — a correctness fix (e.g. handling escaped quotes) must be applied in two places.
- **Fix sketch**: Extract one `fn find_balanced_span(bytes, start, open, close) -> Option<usize>` and have both callers use it with `(b'{', b'}')` / `(b'[', b']')`.
