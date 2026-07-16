# tauri:engine [7/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Dream replay builds O(n²) frame payload and does O(n²) depth resolution
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: quadratic-algorithm
- **File**: src-tauri/src/engine/dream_replay.rs:227
- **Scenario**: Replaying an execution with a few hundred spans. Each of the ~2n frames snapshots `active_span_ids` and `completed_span_ids` as full cloned Vec<String>; `completed_span_ids` grows monotonically, so the last frames each carry nearly all n span ids. A 500-span trace yields ~1000 frames × avg ~250 UUID strings ≈ multi-MB `DreamReplaySession` serialized over Tauri IPC (which also re-embeds all spans via `spans: spans.clone()`). Additionally `compute_depth` (line 149) resolves each parent via `spans.iter().find(...)` — linear scan per hop, O(n²) worst case for deep/chained traces.
- **Root cause**: Per-frame state is materialized eagerly instead of letting the frontend derive it incrementally (frames are already ordered start/end events), and span lookup during depth computation lacks an id→span index map.
- **Impact**: Quadratic memory and JSON serialization cost on the replay command; large traces produce noticeable UI stall and multi-MB IPC payloads for data that is fully reconstructible from O(n) event data.
- **Fix sketch**: Build a `HashMap<&str, &TraceSpan>` once for `compute_depth`. For the payload, drop `active_span_ids`/`completed_span_ids` from each frame — the frame stream already encodes start/end events, so the frontend can maintain the active/completed sets while stepping (or ship only deltas: `opened: span_id`, `closed: span_id`). Keep the cumulative counters, which are O(1) per frame.

## 2. `pack_by_budget` is an exact duplicate of `pack_by_budget_relevance` with similarity 0
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/memory_recall.rs:190
- **Scenario**: The sort + greedy-pack + always-admit-one + omitted-count logic is copy-pasted between `pack_by_budget` (lines 190–216) and `pack_by_budget_relevance` (lines 287–319); only the sort key differs. The module's own test `empty_relevance_matches_value_only_pack` proves the two are behaviorally identical when the relevance map is empty.
- **Root cause**: The relevance variant was added alongside the original instead of the original delegating to it.
- **Impact**: Any future change to packing semantics (budget accounting, tie-breaking, omission counting) must be applied twice; the doc comments even promise the two stay identical, which nothing enforces.
- **Fix sketch**: Implement `pack_by_budget` as `pack_by_budget_relevance(candidates, char_budget, now, &HashMap::new(), 0.0)`, or extract a private `greedy_pack(sorted: Vec<PersonaMemory>, budget) -> PackedRecall` both call after sorting. The existing test already guards the equivalence.

## 3. Clipboard error detector re-lowercases all 13 high-confidence patterns per line
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: allocation-in-hot-loop
- **File**: src-tauri/src/engine/clipboard_error_detector.rs:110
- **Scenario**: `detect_error_pattern` runs on every clipboard change (ambient monitor). For text up to 50KB (thousands of lines), the high-confidence loop calls `pattern.to_lowercase()` for up to 13 constant patterns on every line — tens of thousands of throwaway String allocations per paste, plus a `line.to_lowercase()` per line.
- **Root cause**: The pattern table is stored in mixed case and lowercased at match time inside the innermost loop instead of once.
- **Impact**: Bounded but wholly avoidable allocation churn on a background path that fires on every clipboard event; a large log paste does ~65k allocations for constants.
- **Fix sketch**: Store `HIGH_CONFIDENCE_PATTERNS` already lowercased (they are `const` — just write them lowercase and compare against the lowercased line), or build a `once_cell::sync::Lazy<Vec<(String, &str)>>` of lowercased patterns. Note the table already contains case duplicates ("panic:"/"PANIC:", "fatal error:"/"FATAL ERROR:") that collapse once matching is case-insensitive — MEDIUM_PATTERNS stays case-sensitive by design.

## 4. Aspirational protocol scaffolding: `PipelineStage` and a `MockProtocol` that captures almost nothing
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/protocol.rs:34
- **Scenario**: `PipelineStage` (7-variant enum + `as_str` + `ALL` + Display) is used only by protocol.rs's own tests — the `PipelineStage` hits in runner/mod.rs are the unrelated `SpanType::PipelineStage`. `MockProtocol` is likewise referenced only in this file's tests, and 4 of its 5 trait methods are empty stubs with "would need interior mutability" comments, so it cannot actually assert on output/heartbeat/finalization behavior. Everything is kept compiling via blanket `#[allow(dead_code)]`.
- **Root cause**: The trait boundary shipped with future-facing scaffolding (frontend-mirror stage enum, test double) that never gained real consumers; the ExecutionProtocol trait itself IS used (impl in dispatch.rs, calls in runner/mod.rs) — only the surrounding scaffolding is inert.
- **Impact**: ~120 lines of maintained-but-unused code; the half-implemented mock is a trap — a test using it would silently pass while capturing nothing from `emit_*`/`finalize_status`. Verification needed: confirmed no callers outside protocol.rs via repo-wide grep, but a planned test-mode engine may intend to use it.
- **Fix sketch**: Either delete `PipelineStage` + `MockProtocol` until a real consumer exists (the trait and `StatusFinalization` stay), or finish the mock with `Mutex<Vec<_>>` interior mutability so all five methods capture, and remove the `#[allow(dead_code)]` blankets so the compiler resumes tracking usage.

## 5. Recall sort comparators recompute `decay_score` (incl. timestamp parsing) O(n log n) times
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: repeated-computation
- **File**: src-tauri/src/engine/memory_recall.rs:195
- **Scenario**: `pack_by_budget` / `pack_by_budget_relevance` run before every persona execution's prompt assembly. The `sort_by` closures call `decay_score` for both elements of every comparison — each call re-parses `created_at`/`last_accessed_at` with chrono (string parsing) and does `powf`/`ln`. For a few hundred candidate memories that is thousands of redundant RFC3339 parses per execution.
- **Root cause**: Score is computed inside the comparator instead of once per element.
- **Impact**: Measurable per-execution waste on a path that runs for every persona run; grows superlinearly with memory count. Bounded today, but the cost is pure overhead.
- **Fix sketch**: Precompute `let scored: Vec<(f64, PersonaMemory)> = candidates.into_iter().map(|m| (score(&m), m)).collect();` then sort by the cached key (or use `sort_by_cached_key` with an ordered-float wrapper). One `decay_score`/`parse_ts` per memory instead of per comparison; applies to both pack functions (and composes with finding 2's dedup).

## 6. Leftover no-op `.or_else(|| None)` and uncalled `extract_credential_bindings`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/engine/adoption_answers.rs:209
- **Scenario**: In `apply_credential_bindings_to_connectors`, the binding lookup chains `.cloned().or_else(|| None)` — a literal no-op kept only to host a "Future work" comment. Above it, `extract_credential_bindings` (line 170) is a trivial `.clone()` wrapper explicitly marked `#[allow(dead_code)]` with zero callers repo-wide (verified; the other three functions in this module are actively used from build_sessions/build_simulate/management_api/test_automation).
- **Root cause**: Placeholder for a planned aq_id-style fallback that was never implemented, plus a speculative accessor added ahead of its consumer.
- **Impact**: Cosmetic, but the no-op combinator reads as if a fallback exists and the dead export inflates the module's public surface.
- **Fix sketch**: Delete `.or_else(|| None)` (keep the future-work note as a plain comment on the `get` call) and remove `extract_credential_bindings` — `answers.credential_bindings` is a public field; the runtime can read it directly when the credential-resolution wiring lands.
