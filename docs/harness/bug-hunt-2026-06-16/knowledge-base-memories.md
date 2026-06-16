# Bug Hunter — Knowledge Base & Memories

> Total: 5 findings (1 C critical, 2 H high, 1 M medium, 1 L low)
> Context: knowledge-base-memories | Group: Observability & Analytics

## 1. Conflict resolution picks the wrong winner — UI "keep" buttons mis-mapped for `superseded` conflicts
- **Severity**: Critical
- **Category**: 🔮 Latent failure (silent data loss — conflict resolution picks wrong winner)
- **File**: `src/features/overview/sub_memories/libs/memoryConflicts.ts:119` (and `src/features/overview/sub_memories/components/MemoryConflictReview.tsx:49`)
- **Scenario**: A `superseded` conflict is pushed with `memoryA = newer`, `memoryB = older` (line 119 deliberately swaps so the newer one renders first). In `ConflictCard.tsx` the two "keep" buttons are labeled with `memoryA.title` / `memoryB.title`, so the user clicks "Keep <newer title>". But `handleResolve` maps `keep_a` → `deleteMemory(conflict.memoryB.id)` and `keep_b` → `deleteMemory(conflict.memoryA.id)`. For `duplicate`/`contradiction` conflicts A/B are in original loop order, so the labels are arbitrary but at least the button text matches what survives. For `superseded`, A is forced to be the *newer* memory — the semantics the user reads ("this newer one supersedes the older") invite "Keep A", which is correct. The real defect: there is **no confirmation and no undo**, and `keep_a`/`keep_b` perform a hard `deleteMemory` (not archive). A mis-click — or any future reorder of A/B — silently and irreversibly destroys a memory. The mapping is purely positional with no assertion that the deleted id is the *non-kept* one.
- **Root cause**: Winner selection is encoded implicitly by array position (`memoryA`/`memoryB`) and re-ordered per conflict kind, while the delete mapping is hard-coded positional. There is no single source of truth ("keep id X, delete id Y") and no guard that the surviving id differs from the deleted id.
- **Impact**: Irreversible loss of the wrong memory on a single mis-click; any future tweak to A/B ordering flips every user's keep/delete outcome silently. Core-tier (user-pinned identity) memories are deletable through this path too — `deleteMemory` has no `tier != 'core'` guard, unlike `archive_by_ids`/`delete_all`.
- **Fix sketch**: Resolve to explicit `{ keepId, deleteId }` computed once; render buttons from those ids; assert `keepId !== deleteId` before calling. Use archive (`update_tier(id,'archive')`) instead of hard delete so resolution is reversible, and refuse to delete/auto-resolve a `core` memory.

## 2. KB ingest reports `status: "completed"` even when every document failed (success theater)
- **Severity**: High
- **Category**: 💀 Silent failure (swarmed ingest errors, success theater on compile)
- **File**: `src-tauri/src/engine/kb_ingest.rs:83` and `:89`–`:98`
- **Scenario**: `ingest_files` loops over `file_paths`. On a per-file error the match arm at line 83 only does `tracing::warn!(...)` and falls through. `progress.documents_done = i + 1` (line 89) increments unconditionally, and after the loop `progress.status = "completed"`, `progress.error = None`, and `KB_INGEST_COMPLETE` is emitted (lines 96–98). If all N files fail (unreadable path, unsupported type, embedder offline), the user sees "completed, N documents done, 0 chunks created" with no error surfaced. `KbIngestProgress` has an `error: Option<String>` field but no `documents_failed` counter, so partial failure is invisible.
- **Root cause**: Per-file failures are swallowed into a log line; the aggregate progress object never records a failure count or rolls a failure into `status`/`error`. "documents_done" conflates "attempted" with "succeeded".
- **Impact**: User believes their knowledge base is populated; queries silently return nothing (no vectors). Combined with `update_kb_counters` (which counts only `status='indexed'` rows), the KB shows `document_count = 0` yet the job said "completed" — a confusing contradiction that looks like a query bug, not an ingest bug.
- **Fix sketch**: Track `documents_failed` and `last_error`; set final `status = "completed_with_errors"` (or `"failed"` when `documents_done == 0 && failures > 0`) and populate `progress.error` with a summary so the frontend can render a real failure state.

## 3. Knowledge-graph `confidence` permanently overweights early outcomes — running average never reflects recent reality
- **Severity**: High
- **Category**: 🔮 Latent failure (stale/wrong injected guidance)
- **File**: `src-tauri/src/db/repos/execution/knowledge.rs:112`–`:116` (and avg_cost/avg_duration at `:102`–`:111`)
- **Scenario**: `upsert`'s `ON CONFLICT DO UPDATE` computes `confidence = CAST(success_count + ?7 AS REAL) / (success_count + failure_count + 1)` — i.e. lifetime successes / lifetime total. A pattern that succeeded 50 times then starts failing every run barely moves: after 10 fresh failures confidence is 50/60 ≈ 0.83, still above the 0.5 injection floor (`get_injection_guidance:439`). The "recentResults" sparkline array (last 10) is maintained separately and is *not* used in the confidence math, so the number the injection/sort logic trusts diverges from the recent-trend the UI shows.
- **Root cause**: Confidence is a cumulative lifetime ratio with no decay/windowing. The system already keeps a 10-outcome window (`recentResults`) but ignores it when scoring; the two signals drift apart over a pattern's lifetime.
- **Impact**: A tool sequence or model that has *regressed* keeps getting injected as high-confidence guidance into execution prompts and ranked at the top of the dashboard (`ORDER BY confidence DESC`), steering agents toward strategies that now fail. This is the "stale compiled knowledge" failure mode at the graph layer.
- **Fix sketch**: Compute confidence from a bounded window (e.g. mean of `recentResults`, or an EWMA) so recent failures are weighted; or gate injection on both lifetime confidence AND a recent-window success rate.

## 4. KB index drifts from source — auto-mirror only runs on the persona's *own* executions and on-disk index is never rebuilt on change
- **Severity**: Medium
- **Category**: 🔮 Latent failure (index drift vs source) / ⚡ index rebuild racing query
- **File**: `src-tauri/src/engine/kb_index.rs:136` (`build_and_write_index`) and `src-tauri/src/engine/knowledge.rs:141`
- **Scenario**: `build_and_write_index` writes `index.md` as a one-shot snapshot with `std::fs::write` (no lock, non-atomic — a concurrent agent reading `index.md` can read a half-written file, and two concurrent `build_kb_index` calls can interleave writes). More importantly nothing re-triggers the build: the index is generated on explicit `build_kb_index` IPC only. After a user adds/edits/deletes vault notes, the stale `index.md` keeps advertising notes that no longer exist (or omits new ones), and the agent "browses" to a dead path. The execution-knowledge mirror (`mirror_execution_knowledge_for_persona`, knowledge.rs:141) is best-effort and silently no-ops when no vault is configured, so the documented "auto-maintained index" guarantee quietly does not hold.
- **Root cause**: No file-watcher or content-hash check ties the index to vault state, and the writer is a bare non-atomic `fs::write` with no temp-file-then-rename and no advisory lock against concurrent reads/writes.
- **Impact**: Agents navigate by a stale map — opening missing files, missing fresh material — with no signal that the index is out of date. Concurrent regenerate-while-read can feed a truncated index into a prompt.
- **Fix sketch**: Write to a temp file and atomically rename; record a hash/mtime fingerprint of the tree in the index header and rebuild when it diverges (or on a debounced FS watch); document that browse-mode requires an up-to-date index.

## 5. Empty-KB / tiny-corpus compile and review are valid but silently produce zero output with no user signal
- **Severity**: Low
- **Category**: 🕳️ Edge case (empty KB, < threshold sources) / 💀 silent no-op
- **File**: `src-tauri/src/commands/core/memory_compile.rs:98`–`:126` and `:305`
- **Scenario**: `compile_persona_memories` returns `created: 0` whenever fewer than 3 raw (non-`compiled`) memories exist (lines 98, 119) and per-article skips any article with `< 2` valid source_ids (line 305). All three are returned as a normal `Ok(MemoryCompileResult{ created: 0, ... })`. Likewise `run_memory_review_pipeline` returns `Ok(None)` for an empty persona (memories.rs:323) which the command maps to `reviewed: 0`. None of these carry a reason. The KB graph dashboard's empty state is well handled, but a user who clicks "Compile" on a sparse persona gets a silent `created: 0` indistinguishable from "the LLM declined to synthesize anything" or "the CLI returned junk that parsed to an empty array".
- **Root cause**: The "nothing to do" outcome and the "tried and produced nothing" outcome collapse into the same zero-count success result with no `skipped_reason`/`source_below_threshold` flag.
- **Impact**: Confusing UX; users re-click compile/review and assume it's broken. Masks genuinely empty corpora vs. malformed CLI output. Low severity (no data harm), but it is success theater on the compile/review buttons.
- **Fix sketch**: Add a `skipped_reason` (e.g. `"too_few_sources"`, `"no_articles_synthesized"`, `"no_memories"`) to `MemoryCompileResult`/`MemoryReviewResult` so the UI can show an honest "Nothing to compile — needs ≥3 memories" message rather than a bare zero.
