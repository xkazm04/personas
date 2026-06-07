# Bug Hunter Fix Wave 6 — Panics & integrity

> 5 commits, 5 findings closed (4 Critical, 1 High).
> Baseline preserved: `cargo check --features desktop,ml` 0 errors → 0 errors.

## Commits

| # | Commit | Finding | Severity | File(s) |
|---|---|---|---|---|
| 1 | `87c4f1bb8` | twin #1 UTF-8 byte-slice panic | Critical | `db/repos/twin.rs`, `commands/infrastructure/twin.rs` |
| 2 | `6676b7271` | credential-recipes #2 `now_unix_secs()==0` | Critical | `commands/credentials/oauth.rs` |
| 3 | `90ba0c555` | research #1 dangling finding refs | Critical | `db/repos/research_lab.rs` |
| 4 | `f01a79810` | mcp #2 kb_search model/dim mismatch | Critical | `commands/credentials/vector_kb.rs` |
| 5 | `066abfe28` | mcp #3 embed_batch zip drop | High | `engine/kb_ingest.rs` |

## What was fixed (grouped)

**Panic / crash on input (#twin1, #credrecipes2)**
1. **Char-safe truncation.** `record_interaction`'s `&content[..min(500)]` and `twin_reflect`'s `&c.content[..240]` byte-slice a `&str`, panicking on a multi-byte char at the cut (emoji/CJK/accents) — a common path for a multilingual personal-comms feature, and the 240 site had no lower bound. Both now route through `crate::utils::text::truncate_on_char_boundary`.
2. **Invalid clock surfaced.** `now_unix_secs()`'s `unwrap_or(0)` fabricated timestamp 0 on a pre-epoch clock, minting OAuth state that fails its own freshness check → every flow rejected with a misleading "took too long". Both OAuth entry flows now `ensure_valid_clock()?` first and return a clear "set your system clock" error.

**Referential / contract integrity (#research1, #mcp2, #mcp3)**
3. **Dangling finding refs scrubbed.** `research_findings` keeps `source_ids`/`hypothesis_ids`/`source_experiment_ids` as JSON arrays in TEXT, which FK cascade can't touch. `delete_source/hypothesis/experiment` now strip the deleted id from every finding's array inside a transaction before deleting.
4. **kb_search reconciles embedding model/dims.** The per-KB `embedding_model`/`embedding_dims` were recorded at create but never re-read on search, so a default-model change silently produced wrong neighbours (or a hard dim error). kb_search now loads the KB's recorded model+dims and returns a clear "re-index" error on mismatch.
5. **embed_batch length asserted.** `zip(batch_ids, embeddings)` silently truncated if the embedder returned fewer vectors, leaving chunks with no vector. Now asserts `embeddings.len() == batch_texts.len()` before the zip and errors (triggering the existing cleanup path).

## Verification

| Check | Result |
|---|---|
| `cargo check --features desktop,ml` errors | 0 (baseline 0) |
| `tsc --noEmit` | 0 (no TS touched) |
| Files modified | 6 |

> `vector_kb.rs` / `kb_ingest.rs` are `#[cfg(feature = "ml")]` — verified with `--features desktop,ml`. The other three are in the default `desktop` build. No new unit tests this wave (the safe-truncate helper already has them; the rest are guard/assert additions).

## Cumulative status (waves 1 + 3 + 4 + 5 + 6)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Crypto — fail closed | 5 (2C / 3H) |
| 3 | Trust-boundary input validation | 6 (2C / 3H / 1M) |
| 4 | Atomicity / TOCTOU | 5 (3C / 2H) |
| 5 | Data-loss (sync / dedup) | 4 (2C / 2H) |
| 6 | Panics & integrity | 5 (4C / 1H) |

**25 of 73 findings closed** (13 Critical, 11 High, 1 Medium). Deferred: execution slot-leak (C), sync cursor (C), 24h-resync (H) — see `followups-2026-06-08.md`. Remaining open: Wave 2 (P2P/remote-control auth) + Wave 7 (autonomous control / success-theater) + the long tail of Mediums.

## Patterns established (catalogue items 19–23)

19. **Byte-slicing user text** — `&s[..N]` on a `&str` panics when `N` lands inside a multi-byte char; `.min(len)` bounds length but not char boundary, and a missing `.min` also OOB-panics on short input. Always char-aware-truncate (`truncate_on_char_boundary` / `chars().take(n)`). *Grep:* `[..` followed by `.len()`/a literal on a content/text field.
20. **`unwrap_or(sentinel)` on a fallible system call** — substituting `0`/`""`/`now` for a failed clock/IO call fabricates a valid-looking value that violates a downstream invariant (here: state freshness). Fail loud with an actionable error at the boundary. *Grep:* `duration_since(UNIX_EPOCH)...unwrap_or`, `.unwrap_or(0)` on time/IO.
21. **Denormalised refs without cascade** — ids stored in JSON/CSV/TEXT have no FK, so deletes leave dangling references the DB can't scrub. Add a transactional deletion hook (or junction tables). *Grep:* `*_ids` TEXT columns; deletes that don't touch the tables referencing them.
22. **Implicit 1:1 contract across an external boundary** — `zip`/index-correlating outputs of an external call (ONNX embed, batch API) without asserting equal length silently drops items. Assert the invariant and fail to trigger cleanup. *Grep:* `.zip(` over a result from `.await`/an FFI/model call.
23. **Write-time metadata never re-validated at read time** — config recorded at create (model, dims, schema version) but not re-checked on use breaks silently when the config drifts. Reconcile the stored value against the current one at the boundary. *Grep:* a `*_model`/`*_version`/`*_dims` column written on create and never read on the hot path.

## What remains

Open themes (per INDEX): Wave 2 P2P/remote-control auth, Wave 7 autonomous control / success-theater — plus the deferred set (execution slot-leak, sync cursor, 24h resync).
