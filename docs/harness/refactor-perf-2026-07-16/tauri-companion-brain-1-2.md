# tauri:companion/brain [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Plugins & Companion | Files read: 18 | Missing: 0

## 1. Timed-out one-shot Claude CLI child processes are never killed (orphaned process leak)
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src-tauri/src/companion/brain/recall_synthesis.rs:350 (same pattern: consolidation.rs:900, reflection.rs:261)
- **Scenario**: A consolidation/reflection/recall-synthesis call hangs (slow Opus, network stall, CLI wedged). `timeout(...)` fires, the function `?`-returns the timeout error *before* `child.wait()`, and the `tokio::process::Child` is dropped. Unlike std, tokio does NOT kill a child on drop by default — the claude.exe process (and its whole model call) keeps running unbounded. recall_synthesis is on the chat path when enabled (60s timeout), so a wedged CLI can accumulate orphans per turn.
- **Root cause**: `Command::new(...)` is built without `kill_on_drop(true)`, and the timeout error path skips `child.kill()`.
- **Impact**: Each timeout leaks one full Claude CLI process (tens-to-hundreds of MB, plus a live subscription request). Repeated timeouts (the exact condition that triggers this) compound into unbounded process/memory growth on the user's desktop.
- **Fix sketch**: Add `cmd.kill_on_drop(true);` in all three `call_claude_oneshot` implementations (consolidation.rs, reflection.rs, recall_synthesis.rs). Optionally, on the timeout branch call `let _ = child.kill().await;` explicitly before returning the error so the reap is deterministic rather than drop-driven.

## 2. Claude one-shot CLI harness triplicated across consolidation / reflection / recall_synthesis
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/brain/consolidation.rs:821 (also recall_synthesis.rs:270, reflection.rs:185)
- **Scenario**: Any change to how ephemeral CLI calls work (arg list, auth forcing, no-console-window guard, stderr collection, the kill_on_drop fix in finding #1, model swap from `claude-opus-4-8`) must be hand-applied in three places; they have already started to diverge — `strip_code_fence` in consolidation.rs:987 tolerates a missing closing fence while recall_synthesis.rs:428 requires it, and `preview` in recall_synthesis.rs:436 lacks the char-boundary backoff that consolidation.rs:1004 has (it can panic slicing multi-byte UTF-8 at `&s[..n]`).
- **Root cause**: consolidation.rs was written first; recall_synthesis.rs and reflection.rs copy-pasted the ~120-line spawn/stream/collect/timeout block plus `extract_assistant_text` (3 identical copies), `strip_code_fence`, `preview`, and the tolerant first-`{`/last-`}` JSON-span extraction.
- **Impact**: ~350 duplicated lines; the divergence is already a latent panic (`preview` UTF-8 slice) and inconsistent fence handling. Every future one-shot feature pays 3×.
- **Fix sketch**: Extract a `brain::oneshot` (or `companion::cli_oneshot`) module: `async fn call_claude_text(prompt: &str, model: &str, timeout: Duration) -> Result<String, AppError>` doing spawn/stdin/stdout-delta-collect/stderr-buffer/wait/kill_on_drop, plus shared `extract_assistant_text`, `strip_code_fence`, `preview`, and `extract_json_span(&str) -> Result<&str>`. Each caller keeps only its prompt builder and typed `serde_json::from_str`.

## 3. Retrieval hot path does per-row hydration (N+1 queries + per-row disk reads) on every chat turn
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/companion/brain/retrieval.rs:203 (with semantic.rs:349, procedural.rs:234)
- **Scenario**: Every chat turn: `list_facts` runs one `load_sources` query per fact (≤14), then `retrieve` calls `semantic::get_fact` per vector-matched id (each = 1 row query + 1 sources query) and `procedural::get_rule` per id (row query + sources query + `fs::read_to_string` of the rule markdown); `list_rules` also re-reads every rule's markdown from disk per call, and `goals::list_goals` re-resolves `brain_root()` and reads a file per goal.
- **Root cause**: Each tier hydrates rows one at a time instead of batching by id, and provenance sources are loaded with a per-parent query instead of one `WHERE fact_id IN (...)`.
- **Impact**: ~30–50 extra SQLite round-trips plus ~15–20 file reads per turn. Bounded by the ALWAYS_INCLUDE caps so it won't blow up, but it is pure fixed overhead on the hottest path in the companion, and it grows with every new tier that copies the pattern.
- **Fix sketch**: Add `load_sources_batch(conn, ids) -> HashMap<String, Vec<String>>` (single IN-query) used by `list_facts`/`list_rules`; add `get_facts_by_ids` / `get_rules_by_ids` batch loaders for retrieval instead of per-id `get_*`. Hoist `brain_root()` out of loops. Procedural/goal bodies can reuse the `excerpt_holds_full_body` trick already applied to episodes to skip most disk reads.

## 4. Brain-module helper functions copy-pasted 8–10× (slugify, sha256_hex, excerpt_500, short_uuid, frontmatter parsing)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/brain/semantic.rs:509 (and doctrine.rs:463, retrieval.rs:431, procedural.rs:394, goals.rs:308, rituals.rs, backlog.rs, episodic.rs, reflection.rs, cockpit.rs)
- **Scenario**: `slugify` appears 5× (semantic, doctrine, retrieval, procedural, goals — with subtly different fallbacks/truncation), `sha256_hex` 7×, `excerpt_500` 7×, `short_uuid`/`short_random`/`short_id` 10× (varying 8/10/12-char lengths), `escape_yaml` 3×, and `body_after_frontmatter` 4× — with `retrieval::parse_role_and_body` (retrieval.rs:453) a verbatim copy of `episodic::parse_episode_body` (episodic.rs:217).
- **Root cause**: Each new brain tier was scaffolded by copying the previous one, including its private helpers, instead of promoting them to a shared `brain::util` module.
- **Impact**: ~250 lines of noise; drift risk is real — doctrine's slugified anchors must match retrieval's `extract_section` slugify exactly for chunk re-extraction to work, yet they are two separate copies that nothing keeps in sync.
- **Fix sketch**: Create `companion/brain/util.rs` with `slugify(s, max_len, fallback)`, `sha256_hex`, `excerpt_at(s, cap)`, `short_id(prefix, len)`, `escape_yaml`, `split_frontmatter -> (yaml, body)`. Replace the copies mechanically; delete `retrieval::parse_role_and_body` in favor of the episodic one. Keep the doctrine/retrieval slugify as one function so anchor generation and anchor lookup can never diverge.

## 5. Doctrine ingest re-runs per-chunk SELECT + per-chunk vec-presence COUNT on every app start
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/companion/brain/doctrine.rs:505
- **Scenario**: `ingest_all` runs on every companion init. For each of the ~hundreds of chunks across 27 docs it issues one `SELECT id, content_hash` (pool checkout per chunk), and for every *unchanged* chunk — the steady-state 100% case — an additional `has_vec_entry` `SELECT COUNT(*)` (doctrine.rs:524, 602). That is ~2 pooled queries per chunk, every startup, forever.
- **Root cause**: `upsert_chunk` is written as an isolated per-chunk operation; the existing-row map and vec-presence set are never prefetched.
- **Impact**: Bounded (a few hundred small local queries) but pure waste on the startup path, and each query does its own pool checkout. Grows linearly with the curated-doc corpus.
- **Fix sketch**: Before the loop, load `HashMap<file_path, (id, content_hash)>` from one `SELECT ... WHERE kind='doctrine'` and a `HashSet<node_id>` from one `SELECT node_id FROM companion_embedding` joined to doctrine nodes; pass both into `upsert_chunk` so the unchanged path does zero queries. `prune_orphans` already fetches all doctrine rows — the same statement can feed the map.

## 6. goals.rs list_goals builds a (sql, rows) tuple only to drop the SQL string
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/companion/brain/goals.rs:156
- **Scenario**: Anyone reading `list_goals` hits `let (sql, rows): (String, Vec<Goal>) = ...` followed by `drop(sql)` (line 184) — the SQL string is cloned into the tuple purely to be discarded, suggesting a leftover from a logging/debug iteration.
- **Root cause**: Dead scaffolding: the branch already prepares and consumes each statement inside its arm; only `rows` is needed.
- **Impact**: No runtime cost worth noting; it's confusing cruft in an otherwise clean module and invites cargo-cult copying into the next tier.
- **Fix sketch**: Return only `Vec<Goal>` from the if/else (`let rows = if let Some(s) = status { ... } else { ... };`), delete the tuple and the `drop(sql)`. While there, hoist `disk::brain_root()?` out of the hydration loop (it is re-resolved per goal at line 189).
