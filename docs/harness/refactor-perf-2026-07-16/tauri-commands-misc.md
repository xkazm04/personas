# tauri:commands (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. FFmpeg/ffprobe binary discovery re-runs full filesystem search on every command call
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: missing-caching
- **File**: src-tauri/src/commands/artist/ffmpeg.rs:88
- **Scenario**: Every artist command (`artist_probe_media`, `artist_extract_audio`, `artist_save_thumbnail`, `artist_measure_loudness`, `artist_trim_file`, `artist_export_composition`, `artist_check_ffmpeg`) calls `find_ffmpeg_path()` — 7 call sites, plus `find_ffprobe_path()` calls it again internally. Loading a Media Studio project that probes N clips runs the whole discovery N+ times.
- **Root cause**: `find_ffmpeg_path()` performs the full cascade each call: ~10 candidate `exists()` stats, a recursive walk of `%LOCALAPPDATA%\Microsoft\WinGet\Packages` (read_dir per package, 2 levels deep), a full PATH-directory walk, and as a last resort spawning `where ffmpeg` / `ffmpeg -version` subprocesses. Nothing is memoized — contrast with `drive.rs`, which caches `MANAGED_ROOT` in a `OnceLock` for exactly this reason.
- **Impact**: Per media operation on the hot preview path (probe + loudness measurement per clip), the app pays a directory-tree walk and possibly a process spawn before ffmpeg even starts. On machines where ffmpeg is only found via the `where`/spawn fallback, that's 1–2 extra process launches per thumbnail/probe.
- **Fix sketch**: Cache the resolved path in a `tokio::sync::OnceCell<Option<PathBuf>>` (or `OnceLock` + one-time blocking resolve) keyed for the process lifetime; `find_ffprobe_path` derives from the cached value. Keep `artist_check_ffmpeg` as the one caller allowed to force a re-scan (or add an explicit `refresh` flag) so a user who installs ffmpeg mid-session can still re-detect it.

## 2. Two identical managed-root cache accessors exported under different names
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/drive.rs:84
- **Scenario**: `cached_managed_root()` (line 84, `pub(crate)`) and `managed_root_cache()` (line 331, `pub`) have byte-identical bodies (`MANAGED_ROOT.get().cloned()`) and near-identical doc comments. Callers split arbitrarily: `engine/prompt/mod.rs:677` and `engine/runner/mod.rs:1126` use the first, `companion/jobs/connector_use.rs:1021` uses the second.
- **Root cause**: The second accessor was added later (companion connector work) without noticing the existing one 250 lines up in the same file.
- **Impact**: Two names for one concept invites divergence — if one ever gains a fallback (e.g. bootstrap-from-app-data), the other silently keeps the old behavior for its callers. Pure maintenance hazard, zero functional benefit.
- **Fix sketch**: Delete `managed_root_cache()`, retarget `connector_use.rs:1021` to `cached_managed_root()`, and widen its visibility to `pub(crate)`→`pub` only if needed (all three callers are in-crate, so `pub(crate)` suffices). Merge the two doc comments.

## 3. `drive_recent` walks the entire drive tree and builds full entries for every file, uncached
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: unbounded-walk
- **File**: src-tauri/src/commands/drive.rs:877
- **Scenario**: The sidebar "Recent" rail asks for the 5 newest files. `walk_recent` recursively visits every directory, calls `build_entry` (a `fs::metadata` + RFC3339 format + mime lookup) for **every file** in the sandbox, accumulates them all in a Vec, sorts the whole thing, then truncates to 5.
- **Root cause**: Top-N selection implemented as collect-all-then-sort, with no result caching. `drive_storage_info` in the same file already earned a 5s TTL cache precisely because "a multi-paste fans out to N full-tree walks" — `drive_recent` has the same fan-out exposure (the rail refreshes after persona exports / drive mutations) but no equivalent guard.
- **Impact**: On a drive with thousands of agent-exported files, each rail refresh is a full-tree stat storm plus O(n log n) sort to return 5 rows; bulk operations multiply it. Bounded by drive size, but this is the surface designed to accumulate files indefinitely.
- **Fix sketch**: Keep only the top N during the walk: collect `(mtime_ms, path)` pairs (skip `build_entry` until the end), maintain a size-N min-heap (`BinaryHeap` with `Reverse`), and call `build_entry` only for the final N survivors. Optionally reuse the `STORAGE_INFO_TTL` pattern with a small cache keyed on `(limit)`, invalidated by the write/delete/copy commands.

## 4. Drive event emission logic duplicated between AppHandle and DbPool variants
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/drive.rs:93
- **Scenario**: `publish_drive_event_from_engine` (lines 93–138) and `emit_drive_event` (lines 570–627) duplicate ~35 lines: basename/extension extraction from `rel_path`, the `json!({path,name,extension})` payload, the `extra` object-merge loop, the `CreatePersonaEventInput` construction, and the warn-on-publish-failure handling. They differ only in how the `DbPool` is obtained (parameter vs `app.try_state`).
- **Root cause**: The engine-side variant was cloned from the command-side one to drop the `AppHandle` dependency instead of extracting the shared core.
- **Impact**: Payload shape changes (e.g. adding a `size` default or new field) must be made twice; the two copies can silently drift, giving engine-emitted and command-emitted `drive.document.*` events different shapes for subscribers.
- **Fix sketch**: Extract `fn build_drive_event_input(event_type, rel_path, extra) -> CreatePersonaEventInput` (plus the publish-and-warn call taking `&DbPool`). `emit_drive_event` becomes "resolve pool from AppHandle → delegate"; `publish_drive_event_from_engine` becomes a thin alias or is deleted in favor of the shared fn.

## 5. `eval_run_detail` re-reads and re-parses the entire run archive to build one run's trajectory
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/eval_runs.rs:707
- **Scenario**: Opening a single run in the Certification Command Center calls `eval_run_detail`, which calls `list_summaries()` — reading and JSON-parsing `scorecard.json` + `run.json` for **every** directory in the archive — just to filter down to the ~handful of same-team runs for the trajectory sparkline. Clicking through K runs re-parses the archive K times.
- **Root cause**: Trajectory synthesis reuses the full-archive listing instead of a per-team read or a shared parsed snapshot; there is no memoization between `list_eval_runs`, `get_cert_status`, and `get_eval_run`, all of which re-walk the same immutable bundles.
- **Impact**: With a growing archive (each dir = 2 JSON reads + parses), detail-open latency scales with total archive size rather than team size. Bounded today (dev-only surface, dozens of runs), but it's O(archive) work per click for O(team) data.
- **Fix sketch**: Cache the parsed summaries behind a short-TTL `OnceLock<Mutex<(Instant, Vec<EvalRunSummary>)>>` (bundles are documented as immutable, so even a 30–60s TTL is safe), or accept a pre-fetched `&[EvalRunSummary]` in `eval_run_detail` and have the frontend pass through the list it already loaded. Either removes the repeated full-archive parse.

## 6. Base64 decode + hash-verification blocks repeated across bundle commands
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/network/bundle.rs:212
- **Scenario**: `apply_bundle_from_clipboard` and `preview_bundle_from_clipboard` each inline the same `base64::engine::general_purpose::STANDARD.decode(...)` + error-mapping expression (three occurrences, two inside one function), and the TOCTOU hash-mismatch check (`hex::encode(sha2::Sha256::digest(&bytes)) != expected` + tracing::error + identical user message) is duplicated verbatim between `apply_bundle_import` (lines 96–110) and `apply_bundle_from_clipboard` (lines 237–251).
- **Root cause**: The clipboard variants were written by copying the file-based commands rather than sharing helpers.
- **Impact**: Divergence risk in security-relevant code: the file path enforces "hash required when preview_id set" (line 89) but the clipboard path does not — likely an accidental asymmetry born of the copy (flagging as consistency-of-guard for a bug-lens follow-up, not fixed here). Message/tracing drift is the everyday cost.
- **Fix sketch**: Add `fn decode_clipboard_bundle(b64: &str) -> Result<Vec<u8>, AppError>` and `fn verify_bundle_hash(bytes: &[u8], expected: &str, context: &str) -> Result<(), AppError>`; both commands call them. While consolidating, decide deliberately whether the clipboard apply should also require the hash when `preview_id` is present.
