# Knowledge Base & Memories — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: knowledge-base-and-memories | Group: Observability & Analytics
> Total: 5 | Critical: 0 | High: 2 | Medium: 2 | Low: 1

## 1. Merge resolution silently deletes core-pinned memories and discards tier / use_case scope / persona attribution
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: knowledge-corruption / data-loss
- **File**: src/features/overview/sub_memories/components/MemoryConflictReview.tsx:72-76 (merge branch) · src/features/overview/sub_memories/libs/conflictHelpers.tsx:42-70 (mergeMemories) · src-tauri/src/db/repos/core/memories.rs:848-913 (repo::merge)
- **Scenario**: Two memories are flagged as a `duplicate`. The user clicks the prominent indigo **Merge** button. `repo::merge` INSERTs a new row from `CreatePersonaMemoryInput` (no `tier`, no `use_case_id`, no `source_execution_id`) and then unconditionally `DELETE`s both originals. If either original was `tier='core'` (user-pinned identity) the pin is destroyed; if it was `active`, the merged replacement defaults to `working` tier (a demotion); any `use_case_id` attribution is dropped. For a cross-persona duplicate (`detectConflicts` explicitly labels "across different agents"), `mergeMemories` sets `persona_id = newer.persona_id`, so the older agent's memory is deleted and effectively reassigned to the other agent.
- **Root cause**: The `keep_a`/`keep_b` branch added an explicit `remove.tier === 'core'` guard (MemoryConflictReview.tsx:62-68), but the `merge` branch and `repo::merge` have NO equivalent guard, and `mergeMemories` only carries title/content/category/importance/tags forward — tier, use_case_id, source_execution_id and per-persona ownership are silently dropped.
- **Impact**: Irreversible loss of user-pinned (`core`) memories and of capability/team scope; cross-persona merges strip a memory from one agent entirely. The contract in db/models/memory.rs (§1, §2) says core is user-only and use_case attribution must survive — merge violates both.
- **Fix sketch**: In `repo::merge`, refuse (or preserve) when either id is `core`; mirror the frontend core guard in the merge branch. Carry `tier` (max of the two, or keep the higher), `use_case_id`, and reject cross-persona merges (or require an explicit target persona). Set the merged row's tier to the stronger of the two inputs instead of defaulting to `working`.
- **Value**: impact=7 effort=3

## 2. LLM memory review overwrites user-curated importance with a coarse score→importance map (runs automatically, includes core)
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: silent-recall-bias / data-loss
- **File**: src-tauri/src/commands/core/memories.rs:549-573 (classify) · :759-778 (apply) · :651-654 (auto_apply defaults true) · :322 (fetch has no tier filter)
- **Scenario**: The user pins a memory at importance 5. They click "Review memories". The CLI scores it 7 ("useful context"). The pipeline maps `7 => 3`, `8 => 4`, `9..=10 => 5` and pushes an `update_importance` for EVERY kept memory regardless of its prior value. In the default `auto_apply = true` path this immediately runs `repo::update_importance(id, 3)`, silently knocking the user's 5 down to 3. Because the fetch at :322 passes no tier filter, `core` memories are included and clobbered too.
- **Root cause**: The score→importance table unconditionally rewrites importance for every "keep" outcome; there is no "only raise, never lower" rule, no skip-if-unchanged, and no exclusion of user-set / core memories. The mapping constants (7→3/8→4/9-10→5) are undocumented magic numbers.
- **Impact**: importance is the PRIMARY injection sort key (`get_for_injection_v2` ORDER BY importance DESC) and the active-tier cap selector (run_lifecycle ACTIVE_CAP=60). Clobbering it biases which memories ever reach the prompt and silently demotes deliberately-pinned knowledge — every review run erodes user intent.
- **Fix sketch**: Only bump importance upward (`new = max(existing, mapped)`), or skip importance writes for `core`/user-edited rows; surface the mapping as named constants with a documented rationale; consider making importance changes proposal-only rather than part of the auto-apply mutation set.
- **Value**: impact=7 effort=3

## 3. execution_knowledge upsert never updates use_case_id on conflict — pattern attribution locks to the first execution and injection then hides it from other capabilities
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-recall-bias / knowledge mis-scoping
- **File**: src-tauri/src/db/repos/execution/knowledge.rs:92-114 (ON CONFLICT) · :430-437 (get_injection_guidance scope filter)
- **Scenario**: A persona runs tool sequence `gmail.read -> sheets.append` first under use_case A (so the INSERT stamps `use_case_id = A`), then later runs the identical sequence under use_case B and persona-wide. The conflict target is `(persona_id, knowledge_type, pattern_key)` — it does NOT include use_case_id — so all later runs merge into the row stamped `A`, and `DO UPDATE SET` never rewrites `use_case_id`. When the persona next runs capability B, `get_injection_guidance` filters `use_case_id IS NULL OR use_case_id = ?2(B)`; the merged, well-validated pattern has `use_case_id = A` and is excluded.
- **Root cause**: `use_case_id` is written only by the INSERT arm (`?3`); the `ON CONFLICT DO UPDATE` block omits it, so whichever capability created the row first owns the attribution permanently, even though executions from other capabilities raised its success_count/confidence.
- **Impact**: A persona "forgets" its own proven tool sequences / failure signatures whenever it runs under a different capability than the one that first recorded them — recall silently degrades and the dashboard counts are attributed to the wrong scope.
- **Fix sketch**: Either include `use_case_id` in the unique key (so per-capability rows coexist), or null-out `use_case_id` on conflict to make a multi-capability pattern persona-wide (`DO UPDATE SET use_case_id = CASE WHEN use_case_id IS NOT excluded.use_case_id THEN NULL ELSE use_case_id END`). Document the chosen rule.
- **Value**: impact=6 effort=3

## 4. Client-side conflict detection only scans the most-recent ~100 memories of the loaded page — conflicts in the tail are never surfaced
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / coverage-gap
- **File**: src/features/overview/sub_memories/components/MemoryConflictReview.tsx:39 (`detectConflicts(memories)`) · src/stores/slices/overview/memorySlice.ts:101-114 (limit 100 / 500-on-search, tier `!archive`) · src/features/overview/sub_memories/libs/memoryConflicts.ts:84-128
- **Scenario**: A persona accumulates 300 memories. `fetchMemories` loads only the 100 most-recent (created_at DESC). `detectConflicts` runs over that slice, so a duplicate/contradiction between memory #5 and memory #200 is never detected; the "N conflicts detected" banner reports a falsely low number and the older contradictory instruction keeps getting injected. There is no indication the scan is partial.
- **Root cause**: Conflict detection is a pure client function fed only the current paginated list, with no "scan full store" path and no note that detection is page-bounded. `seen`/sort logic is correct; the input set is the gap.
- **Impact**: Contradictory or duplicated long-term memory silently survives and is injected, exactly the failure the conflict UI exists to prevent. Severity rises with memory count. (Secondary: O(n²) bigram rebuild per pair makes the 500-on-search path ~250k pair comparisons, which can jank the Memories tab.)
- **Fix sketch**: Run conflict detection server-side over the full per-persona set (or fetch all ids+normalized content for detection only), and/or label the banner as "conflicts among loaded memories" until a full scan exists. Precompute token/bigram sets once per memory instead of per pair.
- **Value**: impact=5 effort=4

## 5. confidence is seeded at 1.0 on a single successful run and display ranking has no run-count floor — one-run flukes outrank battle-tested patterns
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: misleading-ranking / magic-constant
- **File**: src-tauri/src/db/repos/execution/knowledge.rs:126 (INSERT seeds confidence = 1.0 on first success) · :515-518 (get_summary top_patterns ORDER BY confidence DESC) · :406 (list_for_persona ORDER BY confidence DESC)
- **Scenario**: A pattern that has succeeded exactly once gets `confidence = 1.0`. The dashboard "Top Patterns" and the persona knowledge list both order by `confidence DESC` with no `(success_count + failure_count) >= N` floor, so that single-run fluke is shown above a pattern with 80 runs at 0.97 confidence.
- **Root cause**: EMA confidence starts at its max from the first sample, and only the injection queries (`get_injection_guidance` `>= 3`, `get_shared_injection` `>= 2`) apply a sample-size floor — the user-facing display/list queries do not, so confidence reads as "how reliable" while really meaning "recent success rate, possibly n=1".
- **Impact**: Users (and the "recent learnings"/top-patterns surfaces) are misled about which knowledge is trustworthy; low likelihood of harm since injection paths are already floored. Mainly an explainability/trust gap.
- **Fix sketch**: Add a sample-size floor or a confidence-shrinkage term (e.g. Wilson lower bound, or multiply by `min(1, runs/3)`) to the display ORDER BY; or surface run-count alongside confidence so a 1.0@n=1 is visibly distinct. Document the EMA alpha (0.2) and seeding behaviour.
- **Value**: impact=4 effort=3
