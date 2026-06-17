# Test Mastery — Knowledge Base & Memories
> Total: 7 findings (2 critical, 3 high, 2 medium, 0 low)

## 1. Knowledge upsert running-average / confidence math is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/knowledge.rs:36-140 (`upsert`)
- **Current test state**: none (`#[cfg(test)]` count = 0 in this file)
- **Scenario**: Every completed execution funnels through `upsert`, which computes the running `avg_cost_usd`, `avg_duration_ms`, `confidence = success/(total+1)`, and maintains a last-10 `recentResults` window via a read-modify-write inside an IMMEDIATE transaction. The injection paths (`get_injection_guidance`, `get_shared_injection`) gate on `confidence >= 0.5/0.6` and `(success_count+failure_count) >= 2/3` — so a regression in the averaging arithmetic, the success/failure increment, or the `recentResults` truncation silently changes which knowledge gets injected into prompts (or none). The SQL `CASE ... (success_count + failure_count + 1)` divisor is subtle and easy to break in a refactor; nothing would fail.
- **Root cause**: The arithmetic lives entirely in an inline SQL `ON CONFLICT DO UPDATE` string with no integration test exercising a real SQLite connection across multiple upserts of the same `(persona, type, key)`.
- **Impact**: Corrupted confidence/averages degrade or poison knowledge injection (worse agent decisions, wasted tokens) with no visible signal; the `recentResults` sparkline desyncs from counters.
- **Fix sketch**: Add a `#[cfg(test)]` module using an in-memory/temp DB (mirror the pattern other repos use): upsert the same key N times alternating success/failure and assert (a) `success_count`/`failure_count` track exactly, (b) `confidence == success/(total)` after settling, (c) running `avg_cost_usd` equals the true mean within epsilon, (d) `recentResults` is capped at 10 and FIFO-ordered, (e) a second key for the same persona stays isolated. Invariant: `confidence ∈ [0,1]` and equals `success_count/(success_count+failure_count)` at rest.

## 2. detectConflicts / textSimilarity have no tests and exist in two drifting copies
- **Severity**: critical
- **Category**: llm-generatable
- **File**: src/features/overview/sub_memories/libs/memoryConflicts.ts:47-129 and src/features/overview/sub_memories/hooks/memoryConflicts.ts:67-200
- **Current test state**: none
- **Scenario**: `detectConflicts` is the entire engine behind the memory-conflict UI (duplicate / contradiction / superseded), the only safeguard against agents acting on contradictory long-term instructions. It is pure and deterministic, yet has zero tests. Worse, it is duplicated byte-for-byte across `libs/` and `hooks/` (only the `memoryLimits` thresholds are shared) — a bug fixed in one copy regresses in the other with nothing catching it. Today a regression that flips duplicate vs contradiction classification, drops the `seen`-pair dedup, or breaks the supersession older/newer ordering ships silently.
- **Root cause**: Pure detection logic was written without a co-located `.test.ts`; the two-copy structure has no test asserting they agree.
- **Impact**: Real contradictions go unsurfaced (agent follows stale/conflicting memory) or the UI floods with false positives and users stop trusting it.
- **Fix sketch**: llm-generatable batch against ONE shared export (and a parity test importing both copies asserting identical output on a shared corpus). Assert business invariants, not snapshots: (a) two identical memories → exactly one `duplicate` (sim ≥ DUPLICATE_THRESHOLD), no double-count via `seen`; (b) "always X" vs "never X" with high topic overlap → `contradiction`; (c) same-topic pair >1h apart → `superseded` with `memoryA` = newer, `memoryB` = older; (d) same-topic pair <1h apart → NOT superseded (batch-creation guard); (e) `textSimilarity` is symmetric and ∈ [0,1]; (f) sort order = contradiction < duplicate < superseded then by similarity desc.

## 3. Memory-review classification (score→importance, threshold split, ID guard) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/core/memory_compile.rs:274-334 and src-tauri/src/commands/core/memories.rs:502-583
- **Current test state**: exists-but-weak (only `extract_json_array` / `truncate_for_prompt` are tested; the classification + insert-guard logic is not)
- **Scenario**: These are the only guards between raw LLM output and destructive memory writes. `review`'s classifier maps `score < threshold → delete`, else maps `7→3, 8→4, 9-10→5, _→3` importance bumps. `compile` rejects articles whose validated `source_ids.len() < 2` and filters hallucinated IDs against the real set. A regression that mis-maps the score bands, inverts the threshold comparison, or drops the `< 2` / hallucinated-ID filter would delete memories the model wanted kept, or persist fabricated "wiki" memories citing non-existent sources — all while the LLM-spawn path makes the function look "tested."
- **Root cause**: The pure classification/validation is entangled inside large `async` IPC commands that spawn the Claude CLI, so it was never extracted or unit-tested.
- **Impact**: Silent data loss (wrong deletions) or knowledge-base pollution with hallucinated, low-support articles — directly harms agent decision quality.
- **Fix sketch**: Extract the per-review classification and the article-validation loop into pure helpers (`classify_review(reviews, threshold, title_map)`, `validate_article(article, valid_ids)`) and unit-test them. Invariants: score band → exact importance; `score == threshold` is KEPT (boundary); reviews referencing unknown IDs are skipped; articles with <2 valid source_ids are rejected; hallucinated IDs are filtered out before insert.

## 4. mergeMemories produces the conflict-resolution write payload with no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/overview/sub_memories/hooks/mergeMemories.ts:4-35
- **Current test state**: none
- **Scenario**: When a user resolves a `duplicate` conflict by merging, this pure function builds the new memory that replaces two existing rows (the backend `merge_memories` then deletes both). It picks the newer memory's persona/title/category, takes `Math.max` importance, set-dedups tags, and concatenates content (collapsing when identical). A regression — wrong owner selection, importance downgrade, tag loss, or content duplication when contents match — corrupts the surviving memory and the two sources are already deleted. Irreversible.
- **Root cause**: Pure mapper written inline next to the hook with no co-located test.
- **Impact**: Merge silently drops tags / downgrades importance / duplicates content; the data loss is permanent because the originals are deleted in the same flow.
- **Fix sketch**: llm-generatable. Assert: owner/title/category come from the newer `created_at`; `importance === Math.max(a,b)`; tags are the de-duplicated union; identical contents → single copy (no `---` separator); differing contents → both joined exactly once; `stripHtml` applied to title and content.

## 5. kb_ingest counter recompute and orphan cleanup are untested data-integrity paths
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/kb_ingest.rs:299-446 (`embed_and_store_vectors`, `cleanup_orphaned_chunks`, `update_kb_counters`, `document_exists_with_hash`)
- **Current test state**: none in this file
- **Scenario**: The vector-KB ingest path carries three load-bearing data-integrity behaviors that a prior bug-hunt already had to fix: (a) `embed_batch` must return one vector per input or fail loudly (the explicit length-mismatch guard at :318); (b) on embedding failure, chunks AND vectors are deleted atomically inside one transaction (the comment at :338 documents the two corrupt shapes a partial delete causes); (c) `update_kb_counters` recomputes `document_count`/`chunk_count` from `status='indexed'` rows, and `document_exists_with_hash` dedups by content hash. None of these are tested. A refactor that re-zips embeddings without the length check, or splits the cleanup back into two statements, re-introduces zombie chunk_ids / silent search misses / inflated counters.
- **Root cause**: Async ingest with real embedder + vector store has no seam for testing the integrity guards in isolation.
- **Impact**: Unsearchable orphan chunks, duplicate re-ingestion, and wrong document/chunk counts surfaced to users — silent corruption of paid embedding work.
- **Fix sketch**: Use a temp user-DB and a stub `EmbeddingManager`/`SqliteVectorStore`. Tests: embedder returning fewer vectors than inputs → `Err` and `cleanup_orphaned_chunks` leaves zero chunks AND zero vectors (no half-state); `update_kb_counters` counts only `indexed` docs; `document_exists_with_hash` returns true only for an `indexed` row with the same hash (re-ingest is a no-op). Invariant: chunk rows and vector rows are always consistent (both present or both absent).

## 6. normalize_error_pattern (failure-grouping key) has no test
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/engine/knowledge.rs:190-248 (`extract_failure_pattern`, `normalize_error_pattern`)
- **Current test state**: none in this file
- **Scenario**: Failure patterns are grouped by a normalized error key: take first 100 chars, collapse each run of digits to a single `#`, truncate to 80. This key is the `pattern_key` under which failure knowledge accumulates via `upsert`. If normalization stops collapsing digit runs (or the truncation boundary shifts), every execution with embedded IDs/timestamps becomes its own pattern_key — fragmenting the failure graph into singletons that never reach the `(success+failure) >= 2/3` injection floor, so failure knowledge silently never injects.
- **Root cause**: Pure string-normalization helper with no unit test.
- **Impact**: Failure-pattern learning quietly degrades to noise; agents stop benefiting from "this tool times out" style guidance.
- **Fix sketch**: llm-generatable. Assert: `"error 12345 at 67"` and `"error 9 at 0"` normalize to the SAME key; multi-digit runs collapse to one `#`; output length ≤ 80; non-digit text preserved; UTF-8 multibyte input does not panic on truncation (note: current `truncate(80)` is byte-based — add a multibyte case to surface any char-boundary risk).

## 7. Memory category normalization fallback is untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/models/memory.rs:28-39 (`normalize_category`) and src-tauri/src/validation/memory.rs:28-41 (`validate_category`)
- **Current test state**: exists-but-weak (importance bounds are tested via the TS API test at src/api/__tests__/memories.test.ts:67-83; category validation/normalization has no test)
- **Scenario**: `normalize_category` silently coerces any unrecognized category to `"fact"` (the default), while `validate_category` rejects it. These two diverge on purpose, but nothing pins the behavior: a future edit that makes `normalize_category` return the raw input, or that drops a category from `MEMORY_CATEGORIES`, would let invalid categories reach the DB / break the category-filtered queries and the dashboard counts — with no failing test.
- **Root cause**: Small pure validators added without a co-located `#[cfg(test)]` module.
- **Impact**: Invalid categories slip into storage; category filters and stats undercount; the contract between "validate (reject)" and "normalize (coerce)" silently breaks.
- **Fix sketch**: llm-generatable, cheap. Assert: every member of `MEMORY_CATEGORIES` validates OK and normalizes to itself; an unknown category fails `validate_category` but `normalize_category` returns `DEFAULT_MEMORY_CATEGORY` ("fact"); `all_category_info()` keys are exactly `MEMORY_CATEGORIES` (guards the model-vs-validation list from drifting). Invariant: the validation list and the frontend-facing info list never diverge.
