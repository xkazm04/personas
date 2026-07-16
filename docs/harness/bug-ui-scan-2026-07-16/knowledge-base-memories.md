# Knowledge Base & Memories — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 1, High: 1, Medium: 3, Low: 0)

## 1. LLM memory review can hard-delete user-pinned `core` memories — no tier guard on the delete path
- **Severity**: Critical
- **Category**: bug
- **File**: src-tauri/src/commands/core/memories.rs:564 (classification), :801-820 (auto-apply), :921-929 (proposal apply "delete" arm); repo delete is the unguarded `crud_delete!("persona_memories")` at src-tauri/src/db/repos/core/memories.rs:1001
- **Scenario**: User pins a memory to `core` ("Pin to Core"), then runs "Review memories" (default `auto_apply = true`). The pipeline fetches ALL tiers (`repo::get_all` with `tier: None`, memories.rs:348), the prompt sends only id/title/content/category/importance — the LLM never sees the tier — and any memory scored below the threshold (default 7) lands in `ids_to_delete` with no tier check. `repo::delete` then hard-deletes it. The same applies when a curation proposal is applied: the `"delete"` arm calls `repo::delete` directly.
- **Root cause**: Every other batch path honors MEMORY CONTRACT (1) ("core… never auto-modified by any batch path"): `delete_all` filters `tier != 'core'`, `merge` refuses core, `archive_by_ids` refuses core, and the review's own importance-bump path skips core (memories.rs:595). Only the review's *delete* branch — the one irreversible action — was never given the guard. The design assumed importance writes were the dangerous mutation; deletion is worse.
- **Impact**: Irreversible loss of deliberately user-curated identity/principle memories, decided autonomously by an LLM that cannot even know the row is pinned. Contradicts the UI's own promise (ConflictCard disables Merge "Cannot merge a core (pinned) memory") — the same memory the UI protects from merge can be silently deleted by review.
- **Fix sketch**: In `run_memory_review_pipeline`, when `score < threshold` and `meta_map` tier is `"core"`, emit action `"keep"` (or `"proposed_skip_core"`) instead of delete; belt-and-braces, make the apply paths route deletes through a `delete_non_core` helper (or reuse `archive_by_ids` semantics: `DELETE … WHERE id = ? AND tier != 'core'`).

## 2. `normalize_error_pattern` panics on multi-byte error messages (`String::truncate` on a non-char-boundary)
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/knowledge.rs:246
- **Scenario**: An execution fails with an error message containing non-ASCII text — smart quotes/ellipses from upstream API error bodies, localized messages, `→`, emoji — long enough that byte offset 80 of the normalized string falls inside a multi-byte codepoint. `extract_failure_pattern` builds `result` from up to 100 *chars* (digit runs collapsed to `#`, so easily >80 bytes), then calls `result.truncate(80)`, which is byte-indexed and **panics** if 80 is not a char boundary.
- **Root cause**: The function mixes char-based clamping (`chars().take(100)`) with byte-based truncation (`String::truncate`), assuming ASCII error text. `truncate_for_prompt` in memories.rs solves exactly this correctly; this older sibling was never fixed.
- **Impact**: Panic inside `extract_and_persist`, which runs on the post-execution knowledge-extraction path for every *failed* execution — the exact moment error text is guaranteed present. Depending on the calling thread this kills the extraction task or unwinds through the execution-completion handler, so failures with non-ASCII errors never produce failure-pattern knowledge (and may take neighboring bookkeeping down with them).
- **Fix sketch**: Truncate on a char boundary: `let cut = result.char_indices().nth(80).map(|(i, _)| i).unwrap_or(result.len()); result.truncate(cut);` — or build the key with `.chars().take(80).collect()`.

## 3. `compile_persona_memories` is not idempotent — every run re-synthesizes the same sources into duplicate wiki articles (and insert failures are swallowed silently)
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/core/memory_compile.rs:109-117 (source filter), :305-333 (insert loop; `Err(_) => continue` at :332)
- **Scenario**: User clicks "Compile" twice (or re-runs it next week without new episodic memories). The source filter only excludes memories *tagged* `"compiled"` — i.e., previous *outputs* — but the raw source memories are never tagged, archived, or linked after a compile. Run 2 reads the identical raw set and inserts a second "API rate limit policy" article with importance 4 and tags `["compiled","wiki"]`; run N inserts an Nth.
- **Root cause**: The design assumed compile is a one-shot promotion, but nothing records "these sources were already compiled" (the link-table is explicitly a TODO — the `let _ = Uuid::new_v4()` placeholder at :330). There is also no dedup on article title/content. Separately, `repo::create` failures are `continue`d without a log or a slot in the result, so a partial insert failure is invisible (`created` just comes out lower with no explanation).
- **Impact**: Duplicate importance-4 memories accumulate linearly with compile runs, polluting the injection ranking (importance is the primary sort key per MEMORY CONTRACT (6)), inflating memory counts, and later spawning "duplicate" conflicts in the conflict-review UI that the user must clean up by hand.
- **Fix sketch**: After a successful article insert, mark its sources (e.g., add a `compiled` tag or record ids in a link table) and exclude already-compiled sources from the next pass; alternatively dedupe by (persona_id, title) upsert. Log the `Err` in the insert loop and surface a `failed` count in `MemoryCompileResult`.

## 4. Knowledge dashboard manual refresh races the filtered fetch — stale cross-filter data can win and setState fires after unmount
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/overview/sub_knowledge/components/KnowledgeGraphDashboard.tsx:63-91, :221 (Refresh), :429/:458 (`onMutated`), :169 (seed)
- **Scenario**: User clicks Refresh (or verifies/dismisses an annotation, triggering `onMutated`), then immediately switches the persona filter while that request is in flight. The effect-driven fetch for the new persona has an `active` guard, but the manual call ran `fetchData()` with the default `isActive: () => true` — it can resolve *after* the new persona's fetch and overwrite `summary`/`entries` with the previous persona's data (the persona filter is applied server-side, so the client filter won't mask it). The same unguarded call also lands `setState` after the component unmounts (user navigates to another overview tab mid-refresh).
- **Root cause**: Cancellation was designed only for the effect lifecycle; the three imperative call sites (Refresh, `onMutated`, seed) bypass it, so "latest request wins" is not enforced — last *response* wins.
- **Impact**: Dashboard silently shows entries and KPI tiles for the wrong persona/type until the next interaction (data-integrity theater in an observability surface), plus React "setState on unmounted component" churn.
- **Fix sketch**: Replace the `isActive` callback with a monotonically increasing request id in a ref (`const reqId = ++latestReq.current; … if (reqId !== latestReq.current) return;`) inside `fetchData` itself, so every caller — effect or imperative — is guarded identically.

## 5. Create-memory form: agent select displays a persona while the controlled value is empty — Save dead-ends with no explanation; save failures give no in-form feedback
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_memories/components/CreateMemoryForm.tsx:61, :74, :82-96, :115-117
- **Scenario**: `personaId` is seeded once via `useState(personas[0]?.id ?? '')`. If the form mounts before the agent store hydrates (direct navigation to Memories after app start) or while personas is empty, `personaId` stays `''` even after personas arrive. The native select with `value=""` and no matching option *visually shows the first persona's name*, so the user sees an agent selected, fills title/content — and Save stays disabled with only a `title` tooltip ("fill required") that never says which field is the problem. Separately, when `createMemory` rejects, the form does nothing visible: `ok` is false, no success overlay, no inline error (the store's `reportError` goes to global slice state this form never renders) — the button just flips back to "Save Memory".
- **Root cause**: Mount-time snapshot of async store data into local state (no sync when `personas` changes), plus a success-only result branch (`if (ok) setShowSuccess(true)` with no `else`).
- **Impact**: A confused dead-end on the primary creation flow: Save appears arbitrarily disabled despite a filled-out form; and a real save failure (validation, backend down) is indistinguishable from "nothing happened", inviting double-submits and lost content.
- **Fix sketch**: Add `useEffect(() => { if (!personaId && personas.length) setPersonaId(personas[0].id); }, [personas, personaId])` (or a placeholder `<option value="" disabled>`), render an explicit empty state when `personas.length === 0`, and show an inline error banner in the `!ok` branch.
