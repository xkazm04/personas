# tauri:commands/obsidian_brain — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 2 high / 2 medium / 0 low)
> Context group: Backend Data & Commands | Files read: 8 | Missing: 0

## 1. Every graph command re-walks and re-reads the entire vault per invocation
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: missing-caching
- **File**: src-tauri/src/commands/obsidian_brain/graph.rs:96 (walk_vault; call sites at 284, 325, 374, 399, 431, 452)
- **Scenario**: A user with a few-thousand-note vault types a search in the Obsidian Memory connector, or opens a note's backlinks panel. Each of `obsidian_graph_search`, `obsidian_graph_outgoing_links`, `obsidian_graph_backlinks`, `obsidian_graph_list_orphans`, `obsidian_graph_list_mocs`, and `obsidian_graph_stats` calls `walk_vault`, which reads the FULL BODY of every `.md` file into memory and regex-extracts wikilinks — on every single command call. `tfidf_scores` (graph.rs:175) then tokenizes every note body and builds a document-frequency map over *all* tokens in the corpus, even though only the handful of query terms need IDF.
- **Root cause**: Phase-1 "keep it simple" design has no shared index. The module even ships a file watcher (`obsidian_graph_start_watcher`) that emits change events for exactly this invalidation purpose, but the commands never use it to cache anything.
- **Impact**: O(total vault bytes) disk I/O + full-corpus tokenization per command call. On a 5k-note / 50MB vault, one search means reading 50MB and building ~5000 HashMaps before scoring. Backlinks/outgoing-links for a single note pay the same cost. This is the hottest interactive path in the module.
- **Fix sketch**: Cache `Vec<NoteEntry>` (or a slimmer index: title, path, outgoing links, token TF map) in a `OnceLock<Mutex<HashMap<vault_path, CachedIndex>>>` keyed by vault path, with a generation/timestamp. Invalidate via the existing watcher callback (it already collects changed `.md` paths — re-read only those) plus a mtime-based staleness fallback when the watcher isn't running. Also restrict `doc_freq` accumulation in `tfidf_scores` to the query terms only, which removes the per-query full-corpus token map even before caching lands.

## 2. Five near-identical vault walkers and three wikilink extractors duplicated across the module
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/obsidian_brain/graph.rs:96 (also lint.rs:148, semantic_lint.rs:159, revitalize.rs:99, drive.rs:713)
- **Scenario**: A change to walk semantics (e.g. "also skip `.trash`", "cap recursion depth", "follow symlinks policy") must be applied in five places; today they already disagree — `graph.rs::walk_vault` caps depth at 12 and silently skips unreadable dirs, `lint.rs::walk` and `semantic_lint.rs::walk_vault` abort the whole lint on the first `read_dir` error (`?` propagation), `revitalize.rs::scan_vault_notes` is iterative and skip-on-error, `drive.rs::walk_dir_recursive` propagates errors. Wikilink extraction likewise exists three times: `graph.rs::wikilink_re` (regex), `lint.rs::extract_wikilinks` (byte scan) and `semantic_lint.rs::extract_wikilink_targets` (byte scan, near copy of lint's), with subtly different alias/section handling. `relative_path` is copy-pasted verbatim in lint.rs:207 and semantic_lint.rs:182.
- **Root cause**: Each feature (graph, lint, semantic lint, revitalize, drive sync) grew its own directory walk and link parser instead of sharing a `vault_fs` helper.
- **Impact**: Real divergence hazard already manifest (error-handling and depth semantics differ per feature, so the same vault can lint fine but fail to sync, or vice versa), plus ~200 duplicated lines and triplicated tests.
- **Fix sketch**: Add `obsidian_brain/vault_fs.rs` with one `walk_markdown_files(root, opts) -> Vec<PathBuf>` (options: error policy, depth cap), one `extract_wikilinks(&str) -> Vec<String>` with a `strip_alias_and_section` normalizer, and one `relative_path`. Port the five walkers and three extractors to it; keep each caller's current error policy explicit via the options. The existing tests in lint.rs/semantic_lint.rs move to the shared module.

## 3. Watcher debounce thread is never terminated — leaks one thread per watcher (re)start
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src-tauri/src/commands/obsidian_brain/graph.rs:734
- **Scenario**: User switches vaults (or the frontend calls start/stop across remounts). `obsidian_graph_start_watcher` spawns `std::thread::spawn(move || loop { sleep(500ms); ... })` with no exit condition; `obsidian_graph_stop_watcher` and vault switches only drop the `RecommendedWatcher` (`*guard = None`), never the debounce thread.
- **Root cause**: The debounce loop has no shutdown signal tied to the `WatcherHandle` lifetime — it holds its own `Arc` clones of the pending buffer and the `AppHandle`, so nothing it references is ever dropped.
- **Impact**: Each start after a stop/switch accumulates one permanently-sleeping thread that wakes every 500ms for the app's lifetime and pins an `AppHandle` + buffer. Bounded per event but unbounded over a long-running desktop session with repeated vault switching.
- **Fix sketch**: Add an `Arc<AtomicBool>` (or a `std::sync::mpsc` disconnect sentinel) to `WatcherHandle`; the debounce loop checks it each tick and returns when set. Set it in `stop_watcher` and before installing a replacement watcher in `start_watcher`. Alternatively, keep exactly one long-lived debounce thread process-wide and have start/stop only swap the pending buffer and target vault path.

## 4. drive.rs is a fully dormant ~750-line module (`#![allow(dead_code)]`) shipped in the binary
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/obsidian_brain/drive.rs:21
- **Scenario**: The module's own header states the wiring commands (`obsidian_drive_*` in `mod.rs`) are unregistered in `lib.rs`'s `invoke_handler`, and the file-wide `#![allow(dead_code, private_interfaces)]` suppresses every warning that would otherwise flag it. Meanwhile the module carries real logic (path-traversal validator, manifest sync, multipart upload) that is compiled, exported to TS (`DriveSyncResult`/`DriveStatus` via `ts_rs`), and maintained — e.g. the `safe_drive_filename` security fix was invested into code no user can reach.
- **Root cause**: Google Drive sync was built ahead of the product decision to enable it (needs Supabase `drive.file` scope re-auth) and parked behind a blanket allow instead of a feature gate.
- **Impact**: ~750 LOC of unreachable surface that still costs review/maintenance attention, generates TS bindings for types the frontend can't obtain, and pulls its reqwest/multipart code paths into the binary. Verification needed for cross-context callers: confirm `obsidian_drive_*` commands are still absent from `lib.rs` `invoke_handler` and `mod.rs` before acting.
- **Fix sketch**: Make the dormancy explicit and zero-cost: gate the module behind a `drive-sync` cargo feature (`#[cfg(feature = "drive-sync")]` on the `mod drive;` declaration and its `mod.rs` command wrappers) so the blanket `#![allow]` disappears, or — if the feature is not on the roadmap — move it to a branch and delete it from master. If instead it's about to ship, register the commands and remove the allow.
