> Context: tauri:engine [5/10]
> Total: 7
> Critical: 0  High: 0  Medium: 2  Low: 5

## 1. Cloud webhook relay can permanently strand firings under burst
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / edge-case
- **File**: src-tauri/src/engine/cloud_webhook_relay.rs:200, 240-353
- **Scenario**: Each trigger's firings are fetched with `list_trigger_firings(&trigger_id, Some(20))` — only the 20 most-recent rows. If more than 20 firings accumulate between two successful polls (a real burst, or after any downtime), the API returns only the newest 20. The relay filters those against `cutoff` (the pre-poll watermark), publishes them oldest-first, and advances `s.last_seen` (the watermark) to the newest of the *fetched* set. The older firings that occurred after `cutoff` but fall outside the newest-20 window are never fetched; on the next poll they are now `<= watermark` and are skipped forever.
- **Root cause**: The 20-row page cap is treated as "everything since the watermark". The watermark-hold-on-failure logic (correctly) protects against publish failures, but not against firings the query never returned.
- **Impact**: Silent loss of relayed webhook events (data loss) whenever burst volume exceeds the page size between polls.
- **Fix sketch**: Page backward until a firing `<= cutoff` is seen (loop `list_trigger_firings` with an offset/before cursor), or raise the limit and detect "hit the cap" (returned==limit and oldest fetched still `> cutoff`) and refuse to advance the watermark past the unfetched gap.

## 2. Relay holds the async state Mutex across all synchronous DB writes for the whole tick
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition / contention
- **File**: src-tauri/src/engine/cloud_webhook_relay.rs:219-364
- **Scenario**: `let mut s = state.lock().await;` is taken before the firing-processing loop and held until `emit_status` at the end. Inside the loop, `publish_and_upsert_watermark` runs a blocking `pool.get()` + SQLite transaction for every firing across every trigger. Any other task calling `state.lock().await` (e.g. a status read) is blocked for the full duration of all DB writes.
- **Root cause**: The lock is used both to guard `last_seen`/counters and as an implicit tick-serializer, so it is held far wider than the data it protects. (Tick serialization is already handled separately by `tick_lock`.)
- **Impact**: UI status/latency contention; not a correctness bug, but the async lock is held across sync I/O.
- **Fix sketch**: Compute publishes into locals, take `s` only for the short windows that mutate `last_seen`/`total_relayed`, or scope a `{ }` block per state mutation rather than one lock over the entire loop.

## 3. Pairing register() on nonce reuse silently discards an already-approved token
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption / edge-case
- **File**: src-tauri/src/engine/pairing.rs:87-121, 101
- **Scenario**: `register` unconditionally `map.insert(nonce, Pending{ outcome: Pending })`, and the MAX_PENDING guard explicitly allows re-inserting an existing key (`&& !map.contains_key(nonce)`). If the same nonce is registered twice — e.g. a cloud app double-submits `POST /pair/request`, or resends the deep link — after the user has already approved the first (`Outcome::Approved { token, claimed:false }`), the second register overwrites it back to `Pending`, discarding the minted-but-unclaimed token. The app's `GET /pair/claim` then returns `Pending` indefinitely and hangs until a fresh re-approval.
- **Root cause**: `register` treats every call as a new pairing with no check for an in-flight Approved/claimed state on the same nonce.
- **Impact**: Pairing hang / lost token on benign double-submit; minor grief vector if a nonce is known.
- **Fix sketch**: If an entry exists and its outcome is `Approved` (or `Rejected`), return the existing view (idempotent) or an error instead of resetting it to `Pending`.

## 4. Dead code: `resolve_knowledge_hint` (non-cache variant)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src-tauri/src/engine/healing_timeline.rs:25-60
- **Scenario**: `resolve_knowledge_hint` is `pub` and `#[allow(dead_code)]`. A repo-wide grep for `resolve_knowledge_hint\b` (word-boundary, so it does not match `_with_cache`) finds only the definition and one doc-comment reference — no callers. It is fully superseded by `resolve_knowledge_hint_with_cache` (used at line 206), which takes pre-fetched tools/connectors.
- **Root cause**: The cached variant replaced the original; the original was left behind under an `allow(dead_code)` shield.
- **Impact**: Maintainability — ~35 lines of unreachable code plus its own DB-fetch branches that can silently rot.
- **Fix sketch**: Delete `resolve_knowledge_hint`; keep `resolve_knowledge_hint_with_cache` and `resolve_hint_from_cache`.

## 5. Dead code: entire lenient-JSON recovery API is unwired
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/safe_json.rs:98-332
- **Scenario**: `lenient_from_str`, `lenient_from_str_as`, `recover_json`, `strip_code_fences`, `extract_json_body`, `remove_trailing_commas`, `fix_truncated_keywords` are all `#[allow(dead_code)]` with the note "planned API — no Tauri command wires into lenient parsing yet". Grep confirms production references are zero — only the doc header and this module's own `#[cfg(test)]` block call them.
- **Root cause**: Speculative API landed with tests but was never wired into any LLM-output parse path (`workflow_compiler::parse_output` and others still hand-roll their own fence stripping).
- **Impact**: Maintainability — ~195 lines of unused parsing heuristics; also a missed consolidation (workflow_compiler duplicates a subset of the fence-extraction logic).
- **Fix sketch**: Either wire the LLM-output parsers (`workflow_compiler`, kpi/topology JSON paths) to `lenient_from_str_as` and drop their bespoke extraction, or remove the lenient API until a consumer exists.

## 6. Triplicated `resolve_*_field` cascade helpers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/config_merge.rs:266-364
- **Scenario**: `resolve_string_field`, `resolve_f64_field`, and `resolve_i32_field` are structurally identical agent→workspace→global→default cascades; they differ only in the "is this value present" predicate (string checks non-empty; numeric checks `Some`). ~100 lines are near-verbatim copies.
- **Root cause**: Per-type copies instead of a generic over `T` with a presence closure.
- **Impact**: Maintainability — a change to the cascade/`is_overridden` semantics must be made in three places (already a divergence risk: strings treat `""` as absent, numerics do not).
- **Fix sketch**: `fn resolve_field<T>(agent, ws, global, is_present: impl Fn(&T)->bool) -> ConfigField<T>` and pass `|s| !s.is_empty()` / `|_| true`.

## 7. Unused field + parameter in optimizer analytics
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/optimizer.rs:55-61, 194-201
- **Scenario**: `NodeStatusEntry.persona_id` is deserialized but `#[allow(dead_code)]` and never read (node stats key on `member_id`). `generate_suggestions` also carries `_pipeline_success_rate: f64` which is computed by the caller (`analyze_pipeline`) and never used inside.
- **Root cause**: Leftover from an earlier analytics shape; the pipeline-level success rate is surfaced on `PipelineAnalytics` directly, so the suggestion generator never needed it.
- **Impact**: Maintainability — minor; a computed value threaded through a signature for no effect.
- **Fix sketch**: Drop the `persona_id` field from `NodeStatusEntry` (or read it) and remove the unused `_pipeline_success_rate` parameter from `generate_suggestions` and its call site.
