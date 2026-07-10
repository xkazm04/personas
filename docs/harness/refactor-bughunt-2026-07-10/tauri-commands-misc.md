> Context: tauri:commands (misc)
> Total: 8
> Critical: 0  High: 1  Medium: 3  Low: 4

## 1. Media-studio persistence commands lack the auth/privileged gate every sibling artist command carries
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src-tauri/src/commands/artist/persistence.rs:76-101, 106-147, 151-176, 234-243
- **Scenario**: `artist_save_composition(composition_json, file_path)` is declared with a bare `#[tauri::command]` — no `#[requires(privileged)]`, no `require_auth*`, and no path sandbox. A caller (e.g. a compromised/renderer-injected IPC message) can invoke it with any `file_path`; `ensure_parent_dir` + `atomic_write` will `create_dir_all` and write to an arbitrary absolute path, clobbering any file the process can write. `artist_load_composition` similarly reads any absolute path. Every sibling artist command (`ffmpeg.rs`, `transcribe.rs`) is `#[requires(privileged)]`; transcribe even validates path shape — so the omission here is an asymmetry, not a deliberate ungating.
- **Root cause**: The persistence surface was written to be driven by a trusted `plugin-dialog` save/open path and never had the IPC trust boundary re-applied; the payload is validated (must parse as `Composition`) but the *destination* is not.
- **Impact**: security / data loss — arbitrary-path file overwrite (and controlled-shape read) from any IPC caller. (Confirm there is no outer global command gate; the explicit `#[requires(privileged)]` on siblings indicates there is not.)
- **Fix sketch**: Add `#[requires(privileged)]` (+ `state: State<'_, Arc<AppState>>`) to `artist_save_composition`, `artist_load_composition`, `artist_autosave_composition`, `artist_clear_autosave`, mirroring `transcribe.rs`; optionally constrain user saves to the `Documents/Personas Media Studio` tree.

## 2. ffmpeg output_path is never validated — protocol/demuxer write & exfiltration vector
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/commands/artist/ffmpeg.rs:575-618 (extract_audio), 622-669 (save_thumbnail), 745-833 (trim), 927-1218 (build_ffmpeg_args output)
- **Scenario**: Every command carefully runs `validate_ffmpeg_input` on the *input* and adds `-protocol_whitelist file` on the input demuxer, but `output_path` is pushed straight to ffmpeg as the positional output with no validation and no output-side protocol restriction. ffmpeg picks the output muxer/protocol from the filename, so an `output_path` like `ftp://host/x.mp4`, `tcp://host:port`, or `tee:...` makes ffmpeg write the encoded media to a remote/attacker endpoint instead of disk (SSRF-style exfiltration of the rendered file).
- **Root cause**: The LFI/SSRF hardening pass covered inputs (`-i`) but treated the output as trusted because it is normally a dialog-chosen path — the commands are directly IPC-invokable with an arbitrary string.
- **Impact**: security — data exfiltration / write to unintended sinks.
- **Fix sketch**: Add an `validate_ffmpeg_output(path)` twin (reject `://` and multi-char `scheme:` prefixes, require a plain local path) and call it on `output_path` in all four commands + at the tail of `build_ffmpeg_args`.

## 3. Clipboard import skips the mandatory-hash TOCTOU guard the file import enforces
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/commands/network/bundle.rs:203-251 (vs 61-110)
- **Scenario**: `apply_bundle_import` has an explicit guard: when a `preview_id` is present, `expected_bundle_hash` is *required* (`preview_id.is_some() && expected_bundle_hash.is_none() → Err`), so a previewed bundle can never be applied without re-verifying its hash. `apply_bundle_from_clipboard` omits that guard — it only runs the hash check inside `if let Some(expected_hash)`. On a preview-cache miss it re-decodes `base64_data` (caller-supplied) and applies it with no integrity check, so the applied bytes can differ from what was previewed/shown to the user.
- **Root cause**: The mandatory-hash rule was added to the file path but not mirrored onto the clipboard path; the two apply functions drifted.
- **Impact**: security — a swapped clipboard payload can be imported after an approved preview (the exact race the file path was hardened against).
- **Fix sketch**: Copy the `if options.preview_id.is_some() && options.expected_bundle_hash.is_none() { return Err(...) }` block into `apply_bundle_from_clipboard` before the hash comparison.

## 4. drive_copy / drive_move create the destination parent before the self-containment check
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/commands/drive.rs:1195-1232 (move), 1234-1291 (copy)
- **Scenario**: Both resolve `dst`, then `create_dir_all(dst.parent())`, and only *after* that reject `dst.starts_with(&src)` ("cannot move/copy a folder inside itself"). For an in-itself move the guard still fires and aborts, but the parent directory tree for the rejected destination has already been created and is left behind as an empty-dir artifact inside the sandbox.
- **Root cause**: Ordering — the semantic guard runs after the filesystem-prep step.
- **Impact**: UX / minor cruft — stray empty directories after a rejected op; no corruption.
- **Fix sketch**: Move the `src.is_dir() && dst.starts_with(&src)` check above the `create_dir_all(parent)` call in both commands.

## 5. Two identical public functions return the cached managed-drive root
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/drive.rs:84-86, 331-333
- **Scenario**: `cached_managed_root()` (`pub(crate)`) and `managed_root_cache()` (`pub`) have byte-identical bodies (`MANAGED_ROOT.get().cloned()`) and identical doc intent. Verified both are live: `cached_managed_root` is called from `engine/runner/mod.rs:1091` and `engine/prompt/mod.rs:677`; `managed_root_cache` from `companion/jobs/connector_use.rs:1014`. So this is redundancy, not dead code.
- **Root cause**: A second accessor was added without noticing the first already existed (different visibility masked the dup).
- **Impact**: maintainability — two names for one concept invite drift.
- **Fix sketch**: Keep one (make it `pub`), delete the other, update the single caller of the removed name.

## 6. drive event-emission payload building is duplicated across the AppHandle and DbPool variants
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/drive.rs:93-138 (publish_drive_event_from_engine), 570-627 (emit_drive_event)
- **Scenario**: Both functions build the same `{path,name,extension}` payload, merge the optional `extra` object the same way, and populate an identical `CreatePersonaEventInput` before calling `events::publish`. The only real difference is the pool source (`AppHandle::try_state` vs a passed `&DbPool`). ~40 lines are near-identical.
- **Root cause**: The engine-side (no-AppHandle) variant was cloned from the command-side one rather than sharing a core.
- **Impact**: maintainability — a payload/schema change must be made in two places.
- **Fix sketch**: Extract `fn build_drive_event_input(event_type, rel_path, extra) -> CreatePersonaEventInput` and have both wrappers call it, then publish against their respective pool.

## 7. OS-clutter skip list is copy-pasted across five directory walkers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/drive.rs:193, 721, 850, 900, 1321
- **Scenario**: `name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini"` appears verbatim in `walk_snapshot`, `drive_list`, `walk_search`, `walk_recent`, and `emit_added_for_subtree`. Any change (e.g. adding `.localized`) must be replicated five times or the walkers diverge.
- **Root cause**: No shared predicate for "ignored filesystem noise."
- **Impact**: maintainability / consistency risk.
- **Fix sketch**: Add `fn is_os_clutter(name: &str) -> bool` and call it in all five sites.

## 8. Repeated `state.network.as_ref().ok_or_else(...)` boilerplate in every discovery command
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/network/discovery.rs:21-27, 36-40, 55-59, 71-75, 86-90, 100-104, 113-117, 150-154, 164-168, 210-214, 229-233, 265-269
- **Scenario**: Roughly a dozen commands repeat the same three-line `let net = state.network.as_ref().ok_or_else(|| AppError::Internal("Network service not initialized".into()))?;` after `require_auth`. Pure ceremony duplicated per command.
- **Root cause**: No accessor for "the initialized network service or a uniform error."
- **Impact**: maintainability — verbose, and the error string is retyped each time.
- **Fix sketch**: Add a small helper (e.g. `fn network(state) -> Result<&NetworkService, AppError>`) or an `AppState::network_or_err()` and call it in each command.
