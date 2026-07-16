# tauri:webbuild — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Core Libraries & State | Files read: 8 | Missing: 0

## 1. Blocking dev-server health probe (up to ~2s) runs inside sync Tauri commands — main-thread UI stalls during boot polling
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: blocking-io
- **File**: src-tauri/src/webbuild/devserver.rs:193 (http_responds; called from status:122 and list:142; surfaced via sync commands `webbuild_status` / `webbuild_list_servers` in src/commands/infrastructure/webbuild.rs:155,165)
- **Scenario**: The frontend polls `webbuild_status` until `healthy` after `webbuild_dev_start`. While Next.js is compiling, the port accepts TCP but never answers, so every poll blocks the full 400ms connect + 400ms write + 1200ms read budget. `webbuild_status`/`webbuild_list_servers` are **sync** `#[tauri::command]` fns, which Tauri v2 executes on the main thread — each poll freezes the whole webview for up to ~2s, repeatedly, during the multi-second dev-server boot. `list()` compounds this: N running servers are probed sequentially.
- **Root cause**: A blocking `std::net::TcpStream` probe with generous timeouts is invoked directly from synchronous command handlers instead of being pushed off the main thread.
- **Impact**: User-visible UI jank/freezes exactly during the "waiting for preview" phase (a hot path in Studio), scaling with poll frequency and server count.
- **Fix sketch**: Make `webbuild_status`/`webbuild_list_servers` `async` (Tauri then runs them on the tokio pool) and wrap `http_responds` in `tokio::task::spawn_blocking` (or port it to `tokio::net::TcpStream` with `tokio::time::timeout`). In `list()`, run the per-server probes concurrently with `join_all`. Alternatively shrink the read timeout — but moving off the main thread is the real fix.

## 2. `extract_build_turn` returns a 6-element anonymous tuple that duplicates `BuildTurnResult` defined 30 lines above
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/webbuild/plan.rs:64-73 (and the repack at src/companion/session.rs:1565-1576)
- **Scenario**: The sole production caller destructures `(reply, phases, question, options, area, selector)` and immediately re-assembles the identical `BuildTurnResult` struct field by field. Every test also destructures positionally with `_` placeholders.
- **Root cause**: The return shape grew field-by-field (A1 options, A3 area/selector) without ever being folded back into the struct that already models it in the same file.
- **Impact**: Three adjacent `Option<String>`s in a positional tuple are a transposition bug waiting to happen (swapping `question`/`area`/`selector` compiles fine), and each new marker field forces edits at every destructuring site.
- **Fix sketch**: Change the signature to `pub fn extract_build_turn(assistant_text: &str) -> BuildTurnResult` and build the struct inside the loop's epilogue. The session.rs caller shrinks to `let mut result = extract_build_turn(&text); commit_snapshot(project_path, &result.reply); Ok(result)`. Update the 5 tests to field access.

## 3. Blocking `std::process::Command` git spawns run on the main thread (sync commands) and inside an async turn
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: blocking-io
- **File**: src-tauri/src/webbuild/versions.rs:26-33, 38-42, 72-76 (via sync commands `webbuild_list_versions`/`webbuild_restore_version` in commands/infrastructure/webbuild.rs:186,197, and `commit_snapshot` inside async `run_build_turn` at companion/session.rs:1568)
- **Scenario**: Opening the version drawer runs `git log` and restoring a snapshot runs `git checkout -- .` synchronously on the main thread (sync Tauri commands); a restore over a large generated tree can freeze the UI for a noticeable beat. `commit_snapshot` (`git add -A` + `git commit`) runs blocking on a tokio worker thread at the end of every build turn.
- **Root cause**: `std::process::Command` used where the surrounding surfaces are the UI thread / async runtime; the module even has an async sibling pattern available (`bun.rs` uses `tokio::process`).
- **Impact**: Bounded but real main-thread stalls on every version-history open/restore; a tied-up tokio worker per build-turn commit. Cost grows with project size as Athena builds out the app.
- **Fix sketch**: Mirror `bun::run`: switch versions.rs to `tokio::process::Command`, make the two commands `async fn`, and `await` `commit_snapshot` in `run_build_turn` (it is already async). Also apply the `hide_window` treatment — these git spawns lack `CREATE_NO_WINDOW`, so each one can flash a conhost window on Windows (same rationale documented in bun.rs).

## 4. `CREATE_NO_WINDOW` + creation_flags boilerplate duplicated across three call sites (and missing at a fourth)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/webbuild/devserver.rs:222-229 (kill_tree), :268-274 (pid_is_node); const also in bun.rs:97
- **Scenario**: The Windows no-conhost recipe (`const CREATE_NO_WINDOW = 0x0800_0000; .creation_flags(...)`) is re-declared inline in `kill_tree` and `pid_is_node`, while `bun::hide_window` exists for exactly this — but only covers `tokio::process::Command`. Meanwhile versions.rs spawns git with no flag at all.
- **Root cause**: `hide_window` was written for the tokio Command type only, so the std::process call sites each re-rolled the constant.
- **Impact**: Pure maintenance drift — a future spawn site (as versions.rs shows) forgets the flag and users get flashing console windows.
- **Fix sketch**: Add a `hide_window_std(&mut std::process::Command)` sibling next to `bun::hide_window` (or a tiny generic in a shared `proc` util), and use it in `kill_tree`, `pid_is_node`, and the versions.rs git spawns. One constant, one place.

## 5. Test mutates the process-global `PERSONAS_BUN_BIN` env var — racy under the default parallel test runner
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: test-hygiene
- **File**: src-tauri/src/webbuild/bun.rs:116-118
- **Scenario**: `resolve_bun_honors_missing_override_gracefully` calls `std::env::set_var`/`remove_var`. Cargo runs tests in parallel threads; any concurrently running test that resolves Bun (or reads env) can observe the bogus override mid-flight, and env mutation from multiple threads is UB territory (`set_var` is `unsafe` as of edition 2024).
- **Root cause**: Process-global state used as a test fixture without serialization.
- **Impact**: Latent flake / future compile friction on edition bump; today the blast radius is small because no other test in this module reads the var, but cross-module tests aren't visible from here.
- **Fix sketch**: Refactor `resolve_bun` to take the override as a parameter (`resolve_bun_with(override_path: Option<&Path>)`) with the public fn reading the env once and delegating; the test then exercises `resolve_bun_with(Some(bogus))` with no global mutation. Or gate the test with a `serial` marker if a serial-test dep already exists.
