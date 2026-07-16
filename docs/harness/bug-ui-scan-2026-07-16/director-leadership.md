# Director & Leadership — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 3, Medium: 2, Low: 0)

## 1. Director seeding is check-then-insert with no DB uniqueness — concurrent boot can create two Directors
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/director.rs:704-751
- **Scenario**: If the user launches the windowed Tauri app while `personas-daemon` is starting (the exact multi-process deployment `engine/leadership.rs` exists to arbitrate — both share the ONE local DB and both run the lib.rs:686 boot path that calls `ensure_director_persona`), both processes can run the `SELECT id FROM personas WHERE name='Director' AND trust_origin='system'` check before either INSERTs.
- **Root cause**: The comment claims "Idempotency key: unique (name, trust_origin='system') pair", but no `CREATE UNIQUE INDEX` on `personas(name, trust_origin)` exists anywhere in the schema — idempotency is enforced only by an unguarded check-then-insert, and leadership gating explicitly does not cover boot-time seeding.
- **Impact**: Two system-owned Director personas. `get_director_persona_id` does `LIMIT 1` with no `ORDER BY`, so which Director is used is non-deterministic per call: scores, manual-review verdicts, Brain notes, and channel posts split across two identities; self-evaluation skip (`target == director_id`) can fail, letting one Director coach the other forever.
- **Fix sketch**: Add a partial unique index (`CREATE UNIQUE INDEX ... ON personas(name) WHERE trust_origin='system'`) plus `INSERT ... ON CONFLICT DO NOTHING` then re-select; alternatively use `INSERT OR IGNORE` keyed on a fixed well-known id for the Director.

## 2. Poll ceiling returns a non-terminal execution whose partial output is treated as the final verdict
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/director.rs:685-696 (used at :636-673 and director_memory.rs:174-181)
- **Scenario**: If the executor queue is busy (another persona holds the runner) or a Director run legitimately takes longer than 360s, `await_execution_terminal` hits `start.elapsed() >= DIRECTOR_RUN_TIMEOUT` and returns the **last-seen, still-running** row (`Ok(ex) if start.elapsed() >= ... => return Some(ex)`).
- **Root cause**: The function's contract blurs "terminal" and "timed out" — the caller `evaluate_with_llm` never re-checks `exec.state().is_terminal()` before parsing.
- **Impact**: Two silent-failure modes: (a) run still queued/streaming with empty `output_data` → the whole evaluation is discarded with only a `tracing::warn`, yet the run keeps executing and its cost is spent while its verdicts/score are lost forever (nothing ever re-parses the completed row); (b) run mid-stream with a partial transcript → verdicts and a DIRECTOR_SCORE parsed from truncated output get routed into `persona_manual_reviews` and stamped onto the target execution as the authoritative review. Same hazard in `cleanup_persona_memories`, where a partial archive list is applied.
- **Fix sketch**: Have `await_execution_terminal` return an enum (`Terminal(ex) | TimedOut(ex)`); on timeout skip parsing/persisting (or persist a "review incomplete" marker), and consider a follow-up reconcile that parses the row once it does reach a terminal state.

## 3. Frontend invoke timeouts are undersized for the eval+cleanup double run — timeout rejection with no cancellation invites duplicate Director runs
- **Severity**: High
- **Category**: bug
- **File**: src/api/director.ts:89-90 (runDirectorOnPersona :92-94, runDirectorBatch :121-127)
- **Scenario**: `run_director_on_persona` → `run_director_cycle_for` runs **two** sequential LLM executions per target: the evaluation (polled up to 360s) and the memory-cleanup pass (another spawn + poll up to 360s), plus queue/finalize latency — worst case well over 720s. The frontend ceiling is `DIRECTOR_RUN_TIMEOUT_MS = 420_000`. Similarly the batch: N starred personas × (2 runs × up to ~6 min) easily exceeds the fixed 30-min `DIRECTOR_BATCH_TIMEOUT_MS` at N ≥ 3 slow personas.
- **Root cause**: The timeout comment ("backend ceiling is 360s") was written for a single run; Phase-2 added the per-persona memory-cleanup run without resizing the frontend budgets, and Tauri invoke timeout rejection does not cancel the backend command.
- **Impact**: The UI reports failure while the backend keeps evaluating and writing verdicts (inverted success theater). A user who retries spawns a second concurrent cycle on the same persona → duplicated manual-review verdicts anchored to the same execution, duplicate channel posts, and double LLM spend.
- **Fix sketch**: Raise the single-target budget to cover two full runs (≥ 900s) and make the batch timeout scale with the persona count (or make the backend emit progress events and drop the client-side ceiling entirely); ideally add backend idempotency (skip a persona reviewed in the last few minutes).

## 4. MemoryCleanupReport dry-run contract lies: `archived_ids` is documented "empty on dry runs" but returns every candidate
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/director_memory.rs:56-57 vs :197-202 (mirrored in src/api/director.ts:97-103)
- **Scenario**: If a UI or script calls `runDirectorMemoryCleanup(personaId, dryRun=true)` and follows the field docs ("Ids actually archived (empty on dry runs)"), it will see `archivedIds` fully populated — `let archived_ids = if dry_run || all_ids.is_empty() { all_ids.clone() } else { ... }` returns the *would-archive* list on a dry run, and `deduped`/`llm_archived` counts also read as completed actions.
- **Root cause**: The struct doc and the implementation diverged; there is no field distinguishing "proposed" from "applied", so dry-run and real-run reports are shape-identical.
- **Impact**: Any consumer trusting the documented contract misreports a preview as an executed archive (e.g. "Archived 37 memories" toast on a dry run), and conversely a consumer relying on `archivedIds` emptiness to detect dry runs mislabels real runs. Undermines the safety story of the reversible-cleanup feature.
- **Fix sketch**: Either honor the doc (empty `archived_ids` + a separate `proposed_ids` on dry runs) or fix the doc and rename the field to `candidateIds`/`affectedIds`; add a test asserting the dry-run shape.

## 5. Re-reviewing an idle persona overwrites the previous review on the same anchor execution — score history silently lost
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/director.rs:662-673 (anchor at :793; trend read at :1262-1281)
- **Scenario**: If the Director evaluates a persona (score 2, coaching written), the user fixes nothing and the persona does not run again, and a later batch/manual cycle re-evaluates it — the new `set_director_review` writes onto the **same** `ctx.latest_execution_id`, replacing the prior `director_score` + markdown.
- **Root cause**: The review is keyed to the target's latest execution row (one score column per execution) rather than to the review event; the design assumes at most one Director review per target execution, but nothing prevents repeated cycles between target runs.
- **Impact**: `list_score_trends` / the roster sparkline show one point per *target execution*, not per review — a persona reviewed 5 times while idle shows a single, always-latest score, so "is coaching moving the needle?" is unanswerable for exactly the low-activity personas the Director flags; the previous review markdown (Director tab) is destroyed with no history.
- **Fix sketch**: Persist reviews in an append-only table (or reuse the Director's own evaluation execution as the anchor) and derive `persona_executions.director_score` as the latest; short-term, skip re-writing when the anchor execution already carries a review and no new target run exists, logging a "no new activity since last review" note instead.
