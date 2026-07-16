# tauri:engine [8/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 2 medium / 4 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Duplicate `PipelineStage` enum in `engine/pipeline.rs` and `engine/protocol.rs`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/pipeline.rs:25 (dup of src-tauri/src/engine/protocol.rs:34)
- **Scenario**: Any change to the pipeline stage list (adding a stage, renaming one) must be made twice; the two copies have already drifted — `pipeline.rs` ends in `Complete`, `protocol.rs` ends in `FrontendComplete` — while both serialize the other 6 variants to identical snake_case strings that also mirror the frontend's `PIPELINE_STAGES`.
- **Root cause**: `pipeline.rs` (tracing-context version, used by `commands/execution/executions.rs`) and `protocol.rs` (contract version, with `as_str()`/`ALL` and its own tests) were written independently; both carry `#[allow(dead_code)]` blocks and duplicate `ALL`, `Display`, and label logic.
- **Impact**: Three sources of truth (two Rust enums + frontend `pipeline.ts`) for one 7-stage contract. A stage added in one enum but not the other silently produces inconsistent trace/event stage names.
- **Fix sketch**: Keep `protocol.rs::PipelineStage` as the single enum (it has the tests), re-export it from `pipeline.rs`, and move `label()`/`boundary()` there as methods. Reconcile the `Complete` vs `FrontendComplete` terminal variant deliberately (one rename, grep both serialized names in the frontend first).

## 2. Per-rule full-text `to_lowercase()` in `QualityGateConfig::check_rules`
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: allocation-in-loop
- **File**: src-tauri/src/engine/quality_gate.rs:120-135
- **Scenario**: Every gated dispatch submission (agent memories, manual reviews — emitted per protocol block per execution) runs `check_rules`, which lowercases the entire combined title+content string once per rule. The default config has 12 memory rules and 21 review rules, so a 50 KB agent output is re-lowercased up to ~21 times (≈1 MB of transient allocations) per submission.
- **Root cause**: `haystack = combined.to_lowercase()` and `needle = r.pattern.to_lowercase()` are computed inside the `for r in rules` loop instead of hoisting the haystack transform out of it.
- **Impact**: O(rules × text_len) allocations + scans on a path that fires for every dispatched memory/review of every execution; pure waste since the lowercased haystack is identical across iterations.
- **Fix sketch**: Lowercase `combined` once before the loop (`let lower = combined.to_lowercase();`) and pick `&lower` or `combined` per rule via `if r.case_sensitive`. Pattern lowercasing per rule is cheap but can also be precomputed if rules are reused; the haystack hoist alone removes ~95% of the cost.

## 3. Dead `IntentCompiler`/`IntentInput` pipeline impl — only the free function is used
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/intent_compiler.rs:44-83
- **Scenario**: The only production caller is `commands::design::analysis::compile_from_intent` (analysis.rs:251), which calls `build_intent_prompt` directly. The `CompilationPipeline` impl for `IntentCompiler` (and the `IntentInput` struct, both `#[allow(dead_code)]`) is claimed by the module doc to exist "for symmetry and tests", but no test in the repo constructs `IntentCompiler` or `IntentInput`.
- **Root cause**: The trait impl was added for architectural symmetry with `PersonaCompiler`/`WorkflowCompiler` but never wired to a call site or a test, and the `#[allow(dead_code)]` silences the compiler's warning that would otherwise flag it.
- **Impact**: ~40 lines of unused abstraction (including a `'static` lifetime hack in `type Input = IntentInput<'static>`) that readers must reconcile against the README's decision matrix; the allow-attribute hides future genuine dead code in the same items.
- **Fix sketch**: Either add the promised test that exercises `IntentCompiler::parse_output`/`assemble_prompt` through the trait (making the impl earn its keep and dropping the `#[allow]`), or delete `IntentCompiler`/`IntentInput` and keep only `build_intent_prompt`, updating `engine/README.md` and `compilation_pipeline.rs`'s registry comment. Verify no cross-crate/daemon caller first (grep found none).

## 4. Worst-case quadratic brace scan in `find_protocol_user_message`
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: quadratic-scan
- **File**: src-tauri/src/engine/channel_reply.rs:48-71
- **Scenario**: For each `{` where `match_json_object` finds no closing brace (e.g. an execution output truncated mid-JSON, or prose/code with unbalanced braces), the scan walks from that `{` to the end of the whole output, then advances `i` by 1 and repeats from the next `{`. A few-hundred-KB `output_data` with many unbalanced `{` after the last complete object costs O(k·n) byte scans, plus a serde parse attempt for every balanced block (code snippets with `{...}` all get parsed).
- **Root cause**: On a failed match the outer loop retries every subsequent `{` individually instead of remembering that no closing brace exists beyond the failure point.
- **Impact**: Runs per finished channel-dispatched execution in the Discord/Slack poller ticks — bounded frequency, but a pathological output can burn tens of ms of CPU per tick doing pure re-scanning. Real but cold-path, hence Low.
- **Fix sketch**: When `match_json_object(bytes, i)` returns `None`, break out of the loop (or record the earliest unclosed-brace position): if the object starting at `i` never closes, no later `{` before another top-level `}` can either — at minimum, `None` from a scan that reached EOF means no further complete object exists, so `return None` is correct and O(n).

## 5. Name collision: two public `PipelineContext` types in `engine`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/engine/pipeline.rs:108 (vs src-tauri/src/engine/pipeline_executor.rs:756)
- **Scenario**: `engine::pipeline::PipelineContext` (per-execution stage tracing, used in `commands/execution/executions.rs`) and `engine::pipeline_executor::PipelineContext` (multi-node team pipeline run args, used in `commands/teams/teams.rs`) share a name but are unrelated. A reader or IDE auto-import following either import line can grab the wrong one silently until a field mismatch errors.
- **Root cause**: Two features ("execution pipeline tracing" and "team pipeline executor") independently chose the same natural name in sibling modules.
- **Impact**: Pure maintenance friction — greps, imports, and docs about "PipelineContext" are ambiguous across the two hottest execution entry points.
- **Fix sketch**: Rename the tracing one to `PipelineTrace` (it is a trace accumulator, matching its `StageTrace` children) — it has exactly one call site to update; leave the executor's struct alone.

## 6. Per-firing `exists_by_source_id` point queries in shared-event relay tick
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/shared_event_relay.rs:129
- **Scenario**: Each relay tick polls up to 50 firings per subscription and issues one `exists_by_source_id` SQLite query per firing before publishing, i.e. up to 50 × subscriptions point lookups per tick, every tick, forever.
- **Root cause**: Dedup is checked one firing at a time inside the loop rather than batched for the fetched page.
- **Impact**: Bounded — indexed SQLite point lookups are microseconds — but it competes for the pool connection with UI reads on every poll and grows linearly with subscription count. Low, flagged because the batch fix is one query.
- **Fix sketch**: Add a `existing_source_ids(pool, &[ids]) -> HashSet<String>` repo helper using `WHERE source_id IN (...)` over the page's ≤50 ids, call it once per subscription poll, and consult the set inside the loop. Cursor-advance semantics (`resolve_published_prefix`) are unchanged.
