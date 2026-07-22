# tauri:commands/design [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 3 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Orphaned LLM adopt-transform pipeline (~800 lines) in template_adopt.rs has zero callers
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/design/template_adopt.rs:1611
- **Scenario**: A maintainer editing the adoption flow (e.g. changing the persona output schema or the TRIGGER POLICY prose) finds two parallel prompt pipelines and updates the wrong one — the one that never runs.
- **Root cause**: The Tauri commands that used to drive the AI-transform adoption path were removed (the `-- Commands --` section at lines 196–213 is now mostly blank, only `get_template_adopt_snapshot` survives), but the whole private pipeline behind them was left in place: `run_unified_adopt_turn1` (:1611), `run_continue_adopt` (:1687), `handle_adopt_result` (:1348), `run_template_adopt_job` (:2310), `build_template_adopt_prompt` (:1825), `build_template_adopt_unified_prompt` (:1471), `summarize_design_result` (:1393), `extract_template_seed_questions` (:1464). Grep across `src-tauri/` confirms none of these are referenced anywhere; live adoption goes through `instant_adopt_template` / `adjust_adoption_draft` and the build-session path.
- **Impact**: ~800 lines (including two full multi-KB prompt templates that duplicate protocol/trigger-policy text now maintained elsewhere) inflate a 3,262-line file, mislead readers about which prompt actually ships, and silently drift from the live contracts. `set_adopt_draft`/`set_adopt_questions`/`set_adopt_claude_session`/`get_adopt_claude_session` (:98–120) are used only by these dead functions and go with them.
- **Fix sketch**: Delete the eight functions plus the four now-unreferenced ADOPT_JOBS helper setters/getters. Keep `ADOPT_JOBS`, `sweep_adopt_jobs`, `list_adopt_jobs`, `cancel_adopt_job`, `get_adopt_snapshot_internal` (still used by `get_template_adopt_snapshot` and `workflows.rs`). Verify with `cargo check` — the compiler's dead_code warnings for this module should drop to zero.

## 2. Event-subscription wiring duplicated between instant-adopt and build-promote paths
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/design/template_adopt.rs:1003
- **Scenario**: A change to the cross-persona chain rule (e.g. new direction synonym, different `source_filter` default, dedup key change) lands in one path but not the other; adopted personas and promoted personas then wire the event bus differently and one of them silently misses handoffs.
- **Root cause**: `wire_event_subscriptions_from_use_cases` (template_adopt.rs:1003) re-implements `create_event_subscriptions_in_tx` + `collect_persona_emit_event_types` (build_sessions.rs:2157 / :2024): same listen-direction filter (already diverged — adopt accepts `"consume"`, promote treats missing direction as `"subscribe"`), same emit-set self-scope-vs-`"*"` defaulting, same `(event_type, source_filter)` dedup, same `INSERT OR IGNORE INTO persona_event_subscriptions`. The comment on each side admits it "mirrors" the other.
- **Impact**: ~140 duplicated lines of subtle bus semantics; the direction-vocabulary drift already exists, proving the hazard is real, not hypothetical.
- **Fix sketch**: Extract one helper (e.g. `engine::event_wiring::wire_listen_subscriptions(conn_or_tx, persona_id, use_cases_json, persona_emits, now) -> u32`) that takes a `&rusqlite::Connection` so it works both inside the promote transaction and on a pooled connection for adopt. Unify the direction predicate (decide whether `"consume"` and default-missing count as listen) and add one unit test covering both call sites.

## 3. Leftover scaffolding: never-constructed promote structs and a stray touch marker
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/design/build_sessions.rs:1096
- **Scenario**: Readers of the promote path assume `PromotePreparation`/`PromoteCounters` describe the actual data flow and search for their construction sites in vain.
- **Root cause**: `PromotePreparation` (:1096) and `PromoteCounters` (:1108) are `#[allow(dead_code)]`-annotated and never instantiated anywhere in the crate (grep-verified); `promote_build_draft_inner` passes the same data as loose locals instead. The file also ends with a leftover cache-busting comment `// touch 1777378957` (:3365).
- **Impact**: Minor, but the `#[allow(dead_code)]` suppressions hide genuine dead code from the compiler forever, and the touch comment is build-debug residue.
- **Fix sketch**: Either delete both structs and the touch comment, or actually adopt `PromotePreparation` as the return of the pre-transaction phase in `promote_build_draft_inner` (which would shrink its argument lists). Deleting is the cheaper, safe option.

## 4. Every streamed CLI line is JSON-parsed up to three times in the transform runner
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-parse
- **File**: src-tauri/src/commands/design/n8n_transform/cli_runner.rs:777
- **Scenario**: A long n8n transform / template rebuild streams thousands of stream-json lines (some carrying multi-KB tool payloads); each line is fully parsed by `parse_stream_line` (:777), parsed again inside `extract_display_text` (analysis.rs:476), and the extracted text is parsed a third time by `should_surface_n8n_output_line` (:634) — all on the tokio worker that is also pumping the child's stdout.
- **Root cause**: Three independent helpers each do their own `serde_json::from_str` on the same line instead of parsing once and sharing the `Value`.
- **Impact**: 2–3x redundant full JSON deserialization on the hottest streaming path in the design module (used by n8n transform, adjustment re-runs, template rebuild, and Turn-2 resume). Wasted CPU scales with output size; large workflow echoes make the stdout pump visibly lag the child process.
- **Fix sketch**: Parse each line once into a `serde_json::Value` in `run_claude_prompt_text_inner`, then pass the parsed value (or `None` for plain text) to session-id capture, display-text extraction, and the surface filter. `should_surface_n8n_output_line` only needs to know "was valid JSON" plus two substring checks — both derivable from the already-parsed value.

## 5. prepare_tool_actions issues 2+ DB lookups per tool inside a loop at promote time
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/design/build_sessions.rs:1303
- **Scenario**: Promoting a persona with N tools runs up to 2N `get_definition_by_name` queries (normalized name, then raw name fallback at :1303–1306), plus one more per drive builtin (:1395) — each acquiring a pooled connection and running a fresh SELECT.
- **Root cause**: Per-item lookup in a loop instead of loading the definitions once. The sibling import path already demonstrates the batch pattern: `confirmation.rs:194` loads all `persona_tool_definitions` in a single query and matches in memory.
- **Impact**: Bounded (tools per persona are typically 3–15, so ~10–30 extra queries per promote), but it is pure waste on the user-facing promote latency path and inconsistent with the in-repo precedent; it also grows linearly as templates ship larger tool sets.
- **Fix sketch**: Fetch `SELECT id, name FROM persona_tool_definitions` once before the loop (or reuse a `HashMap<lowercase_name, id>`), resolve both the normalized and raw names against the map, and drop the per-drive-tool queries the same way. This mirrors `create_persona_atomically`'s approach and removes the fallback double-query.

## 6. extract_first_json_object_matching rescans quadratically and double-copies the input
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: quadratic-scan
- **File**: src-tauri/src/commands/design/n8n_transform/cli_runner.rs:885
- **Scenario**: When the balanced object found at a `{` fails the caller's predicate (or the brace never balances), the scan restarts at `start + 1` (:961) — re-walking the same multi-KB object from every interior `{`. A 50 KB LLM output rich in rejected JSON (e.g. echoed workflow fragments before the real answer) degrades to O(n²) byte scans on the async worker. The `candidates` array (:889) additionally clones the full input twice up front.
- **Root cause**: The retry cursor advances one byte instead of skipping past the region already scanned, and the fence-stripping fallback is built eagerly rather than lazily.
- **Impact**: Millisecond-to-second CPU stalls on pathological outputs for every consumer (`parse_persona_output`, smart search, team synthesis, adjustment parsing); negligible on well-formed outputs, so this is robustness-against-worst-case rather than steady-state waste.
- **Fix sketch**: When a balanced object is found but rejected, set `search_from = end + 1` (skip the whole object) instead of `start + 1`; when no balance is found, break (nothing later can balance either). Build the fence-stripped candidate lazily only if the raw pass found nothing.
