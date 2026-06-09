# Bug Hunter — agent-memories-knowledge
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. apply_persona_memory_review_proposal mutates BEFORE marking applied, with no transaction — crash/concurrency wedges proposal permanently
- **Severity**: critical
- **Category**: state-corruption
- **File**: src-tauri/src/commands/core/memories.rs:807-870
- **Scenario**: User clicks "Apply" on a curation proposal containing 30 deletes + importance bumps. The function runs every `repo::delete` / `repo::update_importance` one-by-one on independent pooled connections (lines 831-861), THEN calls `mark_applied` (line 863). If the process crashes (or the IPC is cancelled, or the user double-clicks) after some deletes land but before `mark_applied` succeeds, the proposal status is still `pending_review`. Re-applying re-runs all entries: the already-deleted memories now return `Ok(false)` ("not found") and pile into `errors`, while the proposal can be applied again indefinitely. Two concurrent Apply clicks both pass the `status != "pending_review"` guard (line 815) and both execute the full mutation set.
- **Root cause**: "Idempotent" is claimed in the doc comment (lines 802-806) but the implementation has no atomicity: mutations are spread across N separate connections with no enclosing transaction, and the status flip is the LAST step instead of a compare-and-swap guarding the whole batch. There is no read-side lock between the guard check and the writes.
- **Impact**: data loss (partial deletes with no record of completion) + corruption (proposal stuck pending, re-applies forever, double-counts importance) + success theater (returns Ok with an errors list the UI may ignore).
- **Fix sketch**: Flip status to `applied` FIRST via an atomic `UPDATE ... WHERE status='pending_review'` (the existing `mark_applied` returns `false` if it didn't transition → bail out as "already applied"); only the winner of that CAS proceeds. Then run all deletes + bumps inside ONE `unchecked_transaction` so a crash rolls back to the pre-apply state and the status flip rolls back with it.

## 2. Knowledge upsert read-modify-write of recentResults races concurrent runs → lost outcomes & wrong running averages
- **Severity**: critical
- **Category**: race-condition
- **File**: src-tauri/src/db/repos/execution/knowledge.rs:49-126
- **Scenario**: Two executions of the same persona that hit the same `(persona_id, knowledge_type, pattern_key)` finish near-simultaneously (common: a persona with `max_concurrent > 1` running the same use case). Each calls `upsert`. Both do a `SELECT pattern_data` (line 59) on separate pooled connections, both read the SAME pre-existing `recentResults` (e.g. `[t,t,f]`), both push their own bool, both write back. The second write clobbers the first → one execution's outcome silently vanishes from the sparkline. The `ON CONFLICT ... success_count = success_count + ?7` arithmetic also interleaves between the SELECT and the INSERT, so the merged `pattern_data` reflects a stale count.
- **Root cause**: The recentResults merge is a non-atomic read (line 59-65) followed by a write (line 84) on different statements, outside any transaction. SQLite's atomic upsert only protects the counter columns, not the application-level JSON merge computed in Rust beforehand.
- **Impact**: data loss (dropped execution outcomes), corruption (recentResults out of sync with success_count/failure_count), UX degradation (knowledge confidence sparkline lies). Capture-from-run racing itself.
- **Fix sketch**: Do the whole upsert in one `unchecked_transaction` with `BEGIN IMMEDIATE` so the SELECT + INSERT-OR-UPDATE are serialized; or push recentResults entirely into SQL (`json_insert`/window) so there is no Rust round-trip. At minimum, wrap SELECT+execute in a transaction and add a retry on `SQLITE_BUSY`.

## 3. Memory compile silently drops valid articles and de-duplicates nothing — re-running stacks duplicate wiki rows
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/commands/core/memory_compile.rs:283-345
- **Scenario**: (a) The model returns a perfectly good article whose `source_ids` the model paraphrased/truncated so only 1 survives the `valid_ids` filter (line 294-304); the article is dropped at line 308 with zero feedback — a real synthesized fact is discarded as "success" (`created` count just silently lower). (b) Running compile twice over the same memory set: there is NO check for an existing `compiled`/`wiki` article with the same title. Each pass inserts brand-new rows (lines 312-325), so the wiki accumulates near-identical "API rate limit policy" articles run after run. Combined with the source skip-filter only excluding tag `"compiled"` (line 112-114) but NOT `"wiki"` consistency, re-compiles inflate unbounded.
- **Root cause**: The pipeline treats "fewer rows inserted" as acceptable shrinkage and has no idempotency key (title/source-set hash) on synthesized articles, so compile is non-deterministic and non-convergent.
- **Impact**: data loss (dropped facts), unbounded memory growth / context blowup (duplicate wiki articles re-injected every run), success theater (`MemoryCompileResult.created` looks fine while real articles vanish).
- **Fix sketch**: Before insert, upsert-by-title (or by a hash of normalized title) within the persona's compiled tag set so a re-compile updates rather than duplicates. Surface dropped-article reasons in the result (mirror `BatchCreateMemoryResult.skipped`) instead of silent `continue`.

## 4. Curation review fetched memories race concurrent capture-from-run / edits → lost-update deletes
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/commands/core/memories.rs:308-322, 637-789
- **Scenario**: `run_memory_review_pipeline` fetches up to 200 memories (line 322), then spends up to 180 s in the Claude CLI (line 477-485). During that window a run captures new memories and/or the user edits importance/content in the Memories UI. When auto-apply returns, it deletes by id (`ids_to_delete`, line 740) and bumps importance (line 762) using the STALE snapshot. A memory the user just hand-edited to importance 5 can be deleted because the LLM scored its pre-edit text low; a memory captured mid-review is invisible to the reviewer but the importance bumps overwrite any concurrent user edit (last-write-wins).
- **Root cause**: Read (fetch) and write (apply) are separated by a multi-minute LLM call with no optimistic-concurrency guard (no `updated_at` / version check on apply). The 24h content-dedup in `create` (repos/core/memories.rs:306-322) does not protect against this; nothing reconciles the snapshot against current rows.
- **Impact**: data loss (user's just-saved memory deleted by stale review), corruption (importance clobbered).
- **Fix sketch**: Carry each memory's `updated_at` into the proposal/apply path and apply deletes/bumps only `WHERE id=? AND updated_at=?` (compare-and-swap); rows that changed since the snapshot are reported as "skipped — changed during review" rather than blindly mutated. Prefer proposal mode as the default so the user re-confirms against current state.

## 5. create() dedup short-circuit returns the existing row but never refreshes it — capture-from-run silently discards new importance/tags/category
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/db/repos/core/memories.rs:306-322
- **Scenario**: A run captures a memory whose `content` is byte-identical to one created <24h ago, but with a HIGHER importance, a corrected category, or new tags (e.g. the agent re-learned the same fact and now rates it critical). `create` finds the dup (line 306-313) and returns the OLD row unchanged (line 321) — the new importance/tags/category are thrown away with only an `info!` log. The caller sees a normal `Ok(memory)` and assumes its data persisted.
- **Root cause**: Dedup is implemented as "first write wins, drop the rest" on content equality alone, with no merge of the more-recent signal (importance/tags) into the surviving row. The function's success contract hides the discard.
- **Impact**: data loss (silently dropped importance upgrades and tag corrections), UX degradation (agent's refined knowledge never surfaces). This is the "importance/dedup logic that silently discards real facts" failure class.
- **Fix sketch**: On dedup hit, merge upward — `UPDATE` the existing row to `MAX(importance)`, union tags, and refresh `updated_at` before returning it; or return a typed "deduped, merged N fields" result so callers can tell a write apart from a no-op.

## 6. extractActionsFromReview never fires in proposal mode — action strings don't match the proposal-mode action enum
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/overview/sub_memories/libs/memoryActions.ts:108-111 (and stores/slices/overview/memorySlice.ts:204-211)
- **Scenario**: When a review runs in proposal mode the backend rewrites detail actions to `proposed_delete` / `proposed_update_importance` (memories.rs:720-726). `extractActionsFromReview` only skips `detail.action === 'deleted'` (line 110) and otherwise extracts; but the slice always calls `reviewMemoriesWithCli(personaId)` with auto-apply defaulting true, so in proposal mode this path is never exercised — and if it ever is, a `proposed_delete` memory (one the LLM wants gone) is treated as keep-worthy and an action rule is minted from a memory slated for deletion. Conversely the duplicate `hooks/memoryActions.ts` (a second, diverging copy with weaker `loadActions` error handling, lines 27-35) can be wired in by mistake, producing inconsistent rule persistence.
- **Root cause**: Action-string contract drift between the two review modes and two duplicated `memoryActions.ts` files (libs vs hooks) that have already diverged in error handling and comments; the consumer only guards the legacy `'deleted'` token.
- **Impact**: UX degradation (action rules generated from memories the reviewer flagged for deletion; user dismissals lost if the weaker hooks copy is used).
- **Fix sketch**: Guard on the full deletion set (`['deleted','proposed_delete'].includes(detail.action)`) and delete the duplicate `hooks/memoryActions.ts`, importing the single hardened libs version everywhere.
