# tauri:companion (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Plugins & Companion | Files read: 16 | Missing: 0

## 1. Installer machinery duplicated verbatim between kokoro_installer.rs and pocket_installer.rs
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/tts/pocket_installer.rs:45
- **Scenario**: Any change to download/progress/extract behavior (retry logic, checksum verification, event shape) must be made twice; the two copies have already drifted once — `sherpa_engine.rs`'s module doc records that independently-pinned engine sources in these two installers caused a real x64-over-arm64 downgrade bug that had to be fixed by extracting the shared piece.
- **Root cause**: `pocket_installer.rs` was created by copying `kokoro_installer.rs`. `InstallPhase`, `InstallProgress`, `emit()`, `download_to_file()` (~55 lines), the `install()` guard/emit-terminal wrapper, and the selective bzip2/tar `extract_model()` skeleton are line-for-line identical (~180 duplicated lines); `stt/downloader.rs` carries a third near-copy of the streaming-download + throttled-progress loop.
- **Impact**: Proven drift hazard (the arch-pin bug) plus 3x maintenance cost on every download-path change; the only genuine differences are the event channel name, model prefix, and the per-file keep predicate.
- **Fix sketch**: Extend `sherpa_engine.rs` (or a new `tts/installer_common.rs`) with the shared pieces: `InstallPhase`/`InstallProgress`, `emit(app, event_name, payload)`, `download_to_file(client, url, dest, app, event_name, phase)`, and an `extract_selected(archive, prefix, dest, keep: impl Fn(&str) -> bool, sentinel: &str)` helper. Each installer shrinks to its URL/prefix/keep-predicate plus the two verification checks. `stt/downloader.rs`'s `stream_to_file` can adopt the same download helper with its `.partial`-rename layered on top.

## 2. connector_use.rs is a ~1450-line god-module with the HTTP-response boilerplate repeated ~15 times
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/jobs/connector_use.rs:219
- **Scenario**: Adding a connector capability means copying the same 15-line block (`send → map_err("X: request failed") → status → text → if !success return truncated-markdown-error → parse JSON → map_err("malformed JSON")`) yet again; a cross-cutting change (e.g. adding retry-on-429, or raising the 500-char truncation) requires touching every handler.
- **Root cause**: Each of the ~18 per-service handlers (sentry, github, slack, gmail, discord, notion, elevenlabs) inlines the identical request/error/markdown scaffolding instead of sharing a helper; all services also live in one file despite the module doc's "new services slot in as match arms" extension model guaranteeing further growth.
- **Impact**: The file is already the largest in the companion tree and grows linearly with every capability; the repeated blocks differ only in service name, capability name, and success-body rendering, so bugs fixed in one copy (e.g. gmail's 401-expired special case) don't propagate.
- **Fix sketch**: Extract `async fn call_json(service: &str, cap: &str, req: reqwest::RequestBuilder) -> Result<CallOutcome, AppError>` returning either parsed `Value` or the pre-formatted "Upstream returned **{status}**" markdown (plus an optional 401 hook). Then split handlers into `jobs/connector_use/{sentry,github,gmail,...}.rs` submodules with the dispatcher + shared helpers in `mod.rs`. Purely mechanical; the dispatch match and public surface stay unchanged.

## 3. PERSONAS_HOME base-dir resolution copy-pasted across the STT/TTS stack
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/stt/downloader.rs:60
- **Scenario**: The identical 8-line block (env `PERSONAS_HOME` override → `dirs::home_dir()` → `.personas`, with the same "could not resolve home directory" error string) appears in `stt/downloader.rs::models_dir`, `stt/whisper.rs::engine_dir`, and `tts/kokoro.rs::model_dir` (and the comments say the same convention lives in the companion disk layer and `tts::engine_dir` too — verify those before consolidating).
- **Root cause**: No shared `personas_home() -> Result<PathBuf, AppError>` helper; each new subsystem re-implemented the convention.
- **Impact**: If the base-dir convention ever changes (portable mode, XDG on Linux), one copy will be missed; it also bloats each file's test suite with duplicate `PERSONAS_HOME` override tests.
- **Fix sketch**: Add `pub fn personas_home() -> Result<PathBuf, AppError>` in a shared companion util (e.g. next to the existing disk layer) and rewrite the three call sites as `personas_home()?.join("companion-stt").join("models")` etc. Grep for `\.personas` / `PERSONAS_HOME` across src-tauri first to catch the remaining copies outside this context.

## 4. New reqwest::Client built per call — no connection reuse on any connector or Pocket TTS request
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: missing-caching
- **File**: src-tauri/src/companion/jobs/connector_use.rs:159
- **Scenario**: Every `connector_use` handler calls `http_client()` which does `reqwest::Client::builder().build()`; likewise `pocket.rs::probe_client()` (polled by the Voice tab for status) and `synthesize_service()` construct a fresh client per request.
- **Root cause**: No shared/static client; each call pays client construction (new connection pool, TLS config) and — more significantly — loses keep-alive, so every request to sentry/github/gmail/the local Pocket service performs a full TCP + TLS handshake.
- **Impact**: Adds ~100-300ms of avoidable latency per external connector call and per Voice-tab status poll (the poll path is periodic, so this repeats indefinitely); also churns sockets. reqwest's own docs recommend one long-lived `Client`.
- **Fix sketch**: `static CONNECTOR_CLIENT: LazyLock<reqwest::Client>` with the 20s timeout in `connector_use.rs`, and a second `LazyLock` pair in `pocket.rs` for the 3s-probe and 90s-synthesis timeouts (or one client with `.timeout()` applied per-request via `RequestBuilder::timeout`). `Client` is cheap to clone and internally Arc'd.

## 5. local_drive count/list/write do blocking std::fs work (including an unbounded recursive walk) directly on the tokio runtime
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: blocking-async
- **File**: src-tauri/src/companion/jobs/connector_use.rs:1115
- **Scenario**: `local_drive_count_files` recursively walks the entire drive root with `std::fs::read_dir`/`metadata` inside an `async fn` with no `spawn_blocking`, no entry cap, and no time budget. A user who points the managed drive at (or syncs into it) a large tree makes one job worker's tokio thread sit in blocking syscalls for the whole walk; `list_files` and `write_text_file` block the same way (smaller, but same pattern).
- **Root cause**: Synchronous filesystem I/O in async context; unlike `scan_codebase` (which has `MAX_FILES_WALKED`, a 60s budget, and runs under `spawn_blocking`), this walker has none of those guards.
- **Impact**: Starves the shared runtime while counting (other async work on that worker stalls), and the walk itself is unbounded — a pathological or junction-looped directory means the job never yields a partial result. Note `follow_links` semantics: `path.is_dir()` follows symlinks/junctions, so a cycle inside the drive root loops forever.
- **Fix sketch**: Wrap the walk in `tokio::task::spawn_blocking`, reuse `scan_codebase`'s cap pattern (max entries + wall-clock budget, report partial totals), and skip symlinked directories via `entry.file_type()` instead of `path.is_dir()`. `list_files`/`write_text_file` can simply move their std::fs calls into `spawn_blocking` or switch to `tokio::fs`.

## 6. scan_codebase allocates an uppercased String for every line of every scanned source file
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: allocation-hot-loop
- **File**: src-tauri/src/companion/jobs/scan_codebase.rs:280
- **Scenario**: `line_has_todo_marker` runs `line.to_ascii_uppercase()` — a fresh heap `String` per line — across every line of every source file up to 256KB in a repo of up to 25k files, i.e. potentially millions of allocations per scan.
- **Root cause**: Case-insensitive substring matching implemented by uppercasing the haystack instead of scanning without allocation.
- **Impact**: Bounded by the 60s budget, but the allocation churn is pure waste on the scan's hottest loop and eats into how much repo fits inside that budget (the walk bails early more often than it needs to).
- **Fix sketch**: Replace with an allocation-free case-insensitive scan, e.g. iterate `line.as_bytes().windows(4/5)` with `eq_ignore_ascii_case` against `b"TODO"`/`b"FIXME"`/`b"HACK"`/`b"XXX"`, or a small hand-rolled `contains_ignore_ascii_case(haystack, needle)` helper. Also short-circuit: check the longest common precondition first (most lines contain none of the markers).
