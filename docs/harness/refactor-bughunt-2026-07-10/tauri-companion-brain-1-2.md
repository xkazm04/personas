> Context: tauri:companion/brain [1/2]
> Total: 8
> Critical: 0  High: 1  Medium: 4  Low: 3

## 1. `ensure_vec_table` Once permanently swallows a first-call failure → whole-process retrieval silently returns nothing
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/companion/brain/embeddings.rs:34-51 (impact at 98-125)
- **Scenario**: The first `ensure_vec_table` caller runs the `INIT_VEC_TABLE.call_once` closure. If it errors (transient `pool.get()` failure, or `CREATE VIRTUAL TABLE` failing because sqlite-vec wasn't registered on that particular pooled connection yet), the closure returns without panicking, so `std::sync::Once` marks itself **completed**. Every subsequent call constructs a fresh local `result = Ok(())`, skips the (already-run) closure, and returns `Ok(())` — even though the table was never created.
- **Root cause**: `Once` records "ran", not "succeeded"; the error is captured into a local that only the very first caller ever sees. There is no retry and no persisted failure state.
- **Impact**: For the rest of the process lifetime, `embed_and_store` INSERTs fail (logged + swallowed as best-effort) and `search_similar` hits `SELECT COUNT(*)…` under `.unwrap_or(0)` → returns an empty `Vec`. Semantic/doctrine/fact vector recall silently degrades to *nothing* with no surfaced error until the app is restarted.
- **Fix sketch**: Don't gate creation on `Once`; rely on `CREATE … IF NOT EXISTS` being cheap, or use a `OnceLock<Result<(),_>>`-style latch that only latches on success and re-attempts on prior failure. At minimum, re-run creation when the previous attempt errored.

## 2. `decay_unused_facts` double-decays every pass — `last_decayed_at` is written but never read
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/companion/brain/consolidation.rs:473-502
- **Scenario**: The decay query selects facts by `f.last_seen_at < cutoff` (30-day window). After decrementing importance it writes `companion_fact.last_decayed_at = now`, and the comment claims this "so the next pass doesn't double-decay". But no query anywhere consults `last_decayed_at`. Because decay itself does not update `last_seen_at`, a fact that isn't recalled will be decremented **again on the very next consolidation pass**. Consolidation is user-triggerable on demand, so importance can be burned from 5→1 in four manual passes on a single afternoon rather than over months.
- **Root cause**: The intended guard (skip facts decayed recently) was never wired into the `WHERE` clause; `last_decayed_at` is a dead write. Additionally the follow-up UPDATE keys off `companion_node.updated_at = ?1` (exact-string equality), which would also catch any unrelated fact updated at the same RFC3339 instant.
- **Impact**: Salience erodes far faster than the 30-day design implies; important-but-not-recently-recalled facts get demoted toward the floor prematurely, weakening retrieval quality.
- **Fix sketch**: Add `AND (f.last_decayed_at IS NULL OR f.last_decayed_at < cutoff)` to the decay query so a fact decays at most once per window; or reset `last_seen_at` semantics deliberately. Drop the fragile `updated_at = ?1` re-select in favor of updating the same id set.

## 3. Applying a consolidation item trusts the LLM's `supersedes_id` and silently demotes an arbitrary fact
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/companion/brain/consolidation.rs:287-346 (effect in semantic.rs:174-179)
- **Scenario**: `RawProposal.supersedes_id` comes straight from the model's JSON and is persisted onto the item unchecked (kind/scope/sources are validated at 200-214, but `supersedes_id` is not). When the user applies the item, `write_fact` runs `UPDATE companion_node SET importance = 0 WHERE id = <supersedes_id>`. If the model hallucinated an id — or cited a real but unrelated fact — that fact is silently dropped out of retrieval. The review UI surfaces the proposal's value, not "this will hide fact X", so the user can't reasonably catch it.
- **Root cause**: No existence/scope validation that `supersedes_id` refers to a live fact in the same scope before the demote.
- **Impact**: Model error can quietly suppress a correct, unrelated memory (data-integrity / memory poisoning), the exact failure the human-in-the-loop step is meant to prevent.
- **Fix sketch**: Before applying, verify `supersedes_id` exists as `kind='fact'`, importance>0, same scope; reject or strip it otherwise. Surface the target fact's value in the review card so the demotion is reviewable.

## 4. Vector recall leaks episodes across conversations, breaking the session isolation `list_recent` enforces
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/companion/brain/retrieval.rs:101, 158-182, 297-339 (search at embeddings.rs:98-125)
- **Scenario**: `episodic::list_recent` is deliberately scoped to one `session_id` (comment at episodic.rs:144-147: multi-conversation migration keeps threads separate). But the vector lane — `search_similar` → `lookup_kinds` → `load_episodes_by_ids` — filters only on `kind='episode'`, never on `session_id`. A semantically similar episode authored in a *different* conversation is therefore pulled into the current thread's prompt.
- **Root cause**: `companion_embedding` has no session column and the episode hydration query (`WHERE kind='episode' AND id IN (…)`) never re-imposes the session filter the recency lane applies.
- **Impact**: One conversation's private context bleeds into another's working memory — inconsistent with the stated isolation model and a mild privacy/coherence bug.
- **Fix sketch**: Join `companion_node.session_id` in `load_episodes_by_ids` and drop episodes not in the active session (or make cross-session sharing an explicit, documented choice rather than an accident of the vector path).

## 5. Identity bullet anchor uses `starts_with` — a short anchor can match the wrong bullet
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/companion/brain/identity.rs:193-203 (callers 243-263)
- **Scenario**: `find_bullet` matches `b == anchor || b.starts_with(anchor)`. `anchor_text` for replace/remove originates from LLM output (profile_synthesis / the correction loop). If two bullets in a section share a prefix (e.g. "prefers terse" and "prefers terse replies on Fridays"), the first prefix match wins and the wrong bullet is replaced/removed.
- **Root cause**: Prefix matching was added so a stored `(ep_xxx)` provenance suffix still matches, but it also matches any shorter anchor against a longer bullet.
- **Impact**: A rare mis-targeted identity edit; user-reviewed so low blast radius, but the preview may not reflect the actually-mutated line.
- **Fix sketch**: Prefer exact match; only fall back to prefix when the remainder looks like a provenance suffix (starts with ` (ep_`), and reject when >1 bullet matches.

## 6. CLI one-shot harness triplicated across consolidation / recall_synthesis / reflection
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/companion/brain/consolidation.rs:821-947, recall_synthesis.rs:263-389, reflection.rs:185-306
- **Scenario**: All three modules contain a near-identical ~80-line `call_claude_oneshot` (same `base_cli_invocation` + argv, `force_subscription_auth`, `apply_no_console_window`, stdin write, stderr-drain task, stream-json line loop, timeout, exit-status check) plus a byte-for-byte `extract_assistant_text`. Verified by side-by-side read: only the timeout constant, the spawn error string, and the return type (envelope vs. plain text) differ. The module docs even say each "mirrors `consolidation::call_claude_oneshot`".
- **Root cause**: Copy-paste when each brain pass was added, with no shared runner extracted.
- **Impact**: Maintainability — a fix to the spawn/stream/auth logic (e.g. the vec-table-style hardening, or a stderr-handling change) must be made in three places; drift risk is real.
- **Fix sketch**: Extract a `brain::oneshot` helper `run_claude_oneshot(prompt, timeout) -> Result<String>` returning the assembled assistant text; each caller keeps only its own prompt builder + typed parse.

## 7. JSON-envelope parse helpers duplicated between consolidation and recall_synthesis
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/companion/brain/consolidation.rs:952-1014, recall_synthesis.rs:391-436
- **Scenario**: `parse_envelope` (find first `{` / last `}`, tolerate fences/preface), `strip_code_fence`, and `preview` are essentially the same in both files (recall_synthesis's `preview` even has a latent non-char-boundary slice `&s[..n]` that consolidation's version already fixed at 1004-1014 — a concrete instance of drift from the duplication).
- **Root cause**: Same copy-paste lineage as finding 6.
- **Impact**: Maintainability + the already-diverged `preview` shows how duplication breeds subtle inconsistency (recall_synthesis:430-436 can panic on a multibyte boundary where consolidation:1004-1014 won't).
- **Fix sketch**: Move `strip_code_fence` + `preview` (the char-boundary-safe version) + a generic `extract_json_span` into the shared `brain::oneshot`/util module; keep only the `serde` target type per caller.

## 8. Per-file string boilerplate duplicated across ~8 brain modules
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: semantic.rs, procedural.rs, goals.rs, doctrine.rs, retrieval.rs, reflection.rs, backlog.rs, episodic.rs, rituals.rs, cockpit.rs, consolidation.rs (helpers sections)
- **Scenario**: `sha256_hex`, `excerpt_500`, `short_uuid`, `slugify`, `body_after_frontmatter`, and `escape_yaml` are re-implemented essentially verbatim in file after file (`excerpt_500` appears ~7×, `short_uuid` ~8×, `slugify` in 5 with only a trailing `.take(40)` variance, `body_after_frontmatter` in procedural/goals/reflection and inline in episodic/retrieval as `parse_role_and_body`). Verified they are pure functions with no module-specific behavior beyond the slug length cap.
- **Root cause**: Each module was written self-contained; no shared `brain::util` exists.
- **Impact**: Maintainability and consistency (e.g. the char-boundary truncation logic is repeated 7× and must be kept correct in each copy).
- **Fix sketch**: Add `companion/brain/util.rs` exposing `sha256_hex`, `excerpt(n)`, `short_id(n)`, `slugify(s, max)`, `body_after_frontmatter`, `escape_yaml`; delete the per-file copies.
