# Bug Hunt — Artist Plugin

> Group: Plugins
> Files scanned: 9 (3 of the listed UI files had drifted; nearest siblings read instead — `CreativeStudioPanel.tsx`, `GalleryPage.tsx`, `MediaStudioPage.tsx`)
> Total: 3C / 6H / 4M / 2L = 15 findings

---

## 1. ffmpeg arg-injection via untrusted output/input path strings

- **Severity**: critical
- **Category**: arg-injection
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:378` (also 410-422, 449-459, 517-531, 545-565, 176-185)
- **Scenario**: A renderer-context exploit (or crafted `.mstudio.json` driving the path through `useMediaStudioPersistence`) calls `artist_extract_audio({input_path: "-i", output_path: "-y bad.txt"})` — or any path beginning with `-`. `cmd.args(["-y", "-i", &input_path])` and `cmd.arg(&output_path)` push the value verbatim, so ffmpeg parses leading-`-` paths as flags. With ffprobe you can supply `-show_format` etc.; with the export commands you can inject `-filter_complex` payloads pointing at filesystem readers (`movie=`).
- **Root cause**: No `--` arg-end separator and no rejection of strings that start with `-`. Path is treated as a position-only token.
- **Impact**: Anyone able to drive an `invoke()` (XSS via dropped HTML, malicious connector page, devtools exposure) can read or overwrite arbitrary files via ffmpeg's `movie=`, `concat:`, `file:` protocols, even when other tauri command entries are auth-gated.
- **Fix sketch**: Reject paths that start with `-` in a shared `validate_ffmpeg_path()` helper, AND insert `--` before every user path (`cmd.args(["-y", "-i", "--", &input_path])` — actually better: prepend `./` for relatives or insist on absolute). Reuse `transcribe::validate_local_file_path` plus a leading-dash check.

## 2. ffmpeg-spawning commands skip auth

- **Severity**: critical
- **Category**: schema-bypass
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:151,171,356,399,443,503`
- **Scenario**: Only `artist_export_composition` (line 284) and `artist_cancel_export` (line 587) call `require_auth(&state)`. `artist_extract_audio`, `artist_save_thumbnail`, `artist_trim_file`, `artist_measure_loudness`, `artist_probe_media`, `artist_compile_render_plan`, `artist_check_ffmpeg` are all `#[tauri::command]` with no auth state at all. A renderer-side compromise can invoke them without an IPC token.
- **Root cause**: Inconsistent application of `require_auth`. The "harmless probe" assumption breaks once the file_path arg is attacker-controlled (see #1).
- **Impact**: Subprocess spawn + arbitrary path read primitive without IPC token. Bypasses the privileged-commands list registered in `ipc_auth`.
- **Fix sketch**: Take `State<'_, Arc<AppState>>` on every command and call `require_auth` (or `require_privileged` for the file-writing ones). Add to `PRIVILEGED_COMMANDS` allow-list.

## 3. Composition source paths injected raw into ffmpeg arg list

- **Severity**: critical
- **Category**: arg-injection
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:711, 763`
- **Scenario**: `args.push(path.clone())` for every `SourceEntry::File`/`Proxy`. The composition JSON is user-editable (Save / Open / autosave) — paste a `.mstudio.json` with `{"path": "-filter_complex", ...}` and the export pipeline emits `-i -filter_complex` which ffmpeg parses as the next flag, opening up `movie=` / `concat:` exfil.
- **Root cause**: The compile pipeline trusts the post-load Composition; there's no arg-shape validation on `SourceEntry.path`.
- **Impact**: Arbitrary-file-read (and arbitrary HTTP fetch via ffmpeg's `http:` protocol) once a malicious composition file is opened. Distribution via "share my video project" zips is plausible.
- **Fix sketch**: In `render_plan::compile`, validate every `SourceEntry::File.path` rejects leading `-` and known ffmpeg URL prefixes (`http:`, `https:`, `concat:`, `pipe:`, `data:`, `file:`). Or run ffmpeg with `-protocol_whitelist file` (already partly true for inputs but not for filter-loaded subfiles).

## 4. Filter-graph injection via `bg_source_hex`

- **Severity**: high
- **Category**: arg-injection
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:728-734, 1071-1079`
- **Scenario**: `bg_hex` comes from `SourceEntry::Color.hex` (or `plan.background_color`) and is interpolated into the lavfi descriptor: `color=c={bg_hex.replace('#','0x')}:s=...`. A composition with `background_color: "red:s=10x10[v];movie=C\\:/secret.txt[v2];[v][v2]"` breaks out of the `color=` token, defines a second filter chain, and reads attacker-chosen files via the `movie=` source.
- **Root cause**: `.replace('#','0x')` is the only sanitization. No regex check that the value matches `#[0-9a-fA-F]{6}` before splatting into a filter string.
- **Impact**: Same primitive as #3 but reachable via a single composition field; bypasses #3 fixes that only check `path`.
- **Fix sketch**: Validate hex with a strict `^#[0-9a-fA-F]{6,8}$` check at compile time; reject otherwise. Same goes for any other user-supplied filter-graph value (currently only this one is at risk, but audit `format!`s in this file).

## 5. Long-lived `-loop 1` image input has no `-t` bound

- **Severity**: high
- **Category**: child-leak
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:760-766`
- **Scenario**: Each image overlay gets `-loop 1 -i <path>` with no per-input `-t` bound. ffmpeg keeps reading the looped image until its output ends, but if an export hangs in another stage (e.g. corrupt audio source on a slow pipe) the looped image input also stays alive. Combined with cancellation (#7) this can leave ffmpeg pinned indefinitely.
- **Root cause**: Image inputs rely on the output-side `-t`/EOS to stop, but cancellation merely flips a token; it does not kill the child.
- **Impact**: Background ffmpeg process keeps consuming CPU/RAM after the user clicks cancel. Repeated cancels stack zombies.
- **Fix sketch**: Add `-t {plan.duration_seconds}` before each `-loop 1 -i` so each image input self-terminates. Independently, fix #7 so cancel actually SIGKILLs the child.

## 6. Cancellation token never kills the ffmpeg child

- **Severity**: high
- **Category**: child-leak
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:309-321, 617-658`
- **Scenario**: `artist_cancel_export` calls `MEDIA_EXPORT_JOBS.cancel(...)` which fires `cancel_token`. The `tokio::select!` arm wins, returns `Err`. But the `child` is owned inside `run_ffmpeg_export`'s future, which is now being dropped without ever calling `child.kill()`. Tokio's `Drop` for `Child` does NOT kill by default — the OS process keeps running until natural EOS. Multiple cancelled exports therefore stack.
- **Root cause**: Author assumed `tokio::select!` cancelling a future drops the `Child` and kills it; that's only true when `kill_on_drop(true)` is set on the `Command`, which it isn't here.
- **Impact**: User clicks Cancel → UI says "cancelled" → ffmpeg keeps writing the half-done MP4, churning the GPU/CPU. Exporting again immediately starts a second ffmpeg fighting for the same output handle.
- **Fix sketch**: Set `cmd.kill_on_drop(true)` on every `Command` that may outlive its caller. Or split `run_ffmpeg_export` to keep `Child` outside the select and explicitly `child.start_kill()` in the cancel arm.

## 7. Whisper transcribe spawns are uncancellable & untracked

- **Severity**: high
- **Category**: child-leak
- **File**: `src-tauri/src/commands/artist/transcribe.rs:236-279`
- **Scenario**: `local_whisper_transcribe` does `cmd.output().await` with no cancellation token, no `kill_on_drop`, no process registry. UI invokes via `artistTranscribeMedia` (600s timeout). If user starts transcribe → invoke times out → no Rust-side cancel → whisper keeps running for minutes. Click again: a second whisper spawns. With even 4 concurrent retries on a 4-core machine, the system locks up.
- **Root cause**: No cancellation contract on transcribe at all; the 600s frontend timeout abandons but doesn't kill.
- **Impact**: Power users hit this regularly because tiny-model whisper is still slow on long clips. Also a DoS primitive — invoking transcribe repeatedly with large files exhausts CPU.
- **Fix sketch**: Mirror `MEDIA_EXPORT_JOBS` — give transcribe a `BackgroundJobManager` keyed by `clip_id`, return a job_id, expose `artist_cancel_transcribe`, set `kill_on_drop(true)` on the command. Reject duplicate in-flight jobs for the same `file_path`.

## 8. `artist_load_transcript` reads any file that ends `.transcript.json`

- **Severity**: high
- **Category**: path-traversal
- **File**: `src-tauri/src/commands/artist/transcribe.rs:177-192`
- **Scenario**: After `validate_local_file_path` (which only checks UNC/ADS/`..`) the function reads whatever absolute path ends in `.transcript.json`. An attacker who can plant a same-suffix file in a known location (e.g. via the ffmpeg arg-inject in #1, or by tricking the user to download `secrets.transcript.json`) reads it back. The validator also passes `C:/Windows/Temp/x.transcript.json` etc.
- **Root cause**: "Privileged" enforcement is the renderer's IPC token, not a containment root. There is no `assert_within(app_data_dir | source_clip_parent)` check.
- **Impact**: Information disclosure via a privileged Tauri command. Combined with #7 it's also a self-DoS — load a 4GB file, get a 4GB allocation in the renderer.
- **Fix sketch**: Track which clip the transcript belongs to (parent dir of last transcribe), and reject any `transcript_path` not matching that registered set. At minimum, cap read size at 16 MiB and require `tokio::fs::canonicalize` to land under a whitelisted root.

## 9. JSON-DoS via `artist_compile_render_plan`

- **Severity**: high
- **Category**: dos-input
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:260-271`
- **Scenario**: `composition_json: String` has no size cap. `useRenderPlan` invokes this on every composition edit (preview keystrokes). A pathological input — a composition with 100k items, or a deeply nested JSON — runs `serde_json::from_str` then `render_plan_compile` on the tokio worker without `spawn_blocking`. The worker stalls; subsequent IPC hangs.
- **Root cause**: Pure-function reasoning ("no I/O so no auth needed") didn't account for CPU/allocation DoS on a hot path.
- **Impact**: Single oversized composition (e.g. accidentally pasted from clipboard) freezes the entire Tauri runtime — not just the studio tab.
- **Fix sketch**: Cap input length (e.g. 4 MiB) before `serde_json::from_str`. Run `serde_json::from_str` + `render_plan_compile` inside `tokio::task::spawn_blocking`. Add an `O(n)` item-count guard inside the compiler.

## 10. Anchor-word resolver effect can feedback-loop

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/plugins/artist/sub_media_studio/MediaStudioPage.tsx:72-82`
- **Scenario**: The `useEffect` reads `composition.items`, calls `resolveAnchor(...)`, then if the result differs by ≥0.01 calls `updateItem(beat.id, {startTime})`. That mutates `composition.items`, retriggering the effect. If `resolveAnchor` is non-deterministic across renders (e.g. transcript cache loads/evicts mid-flight) or if floating-point computations oscillate at the 0.01 boundary, the effect runs every render forever, blocking input.
- **Root cause**: No "did anything actually change" gate on the dependency array; `composition.items` identity changes after the write.
- **Impact**: Mysterious 100% CPU + frozen timeline when a transcript loads with a near-boundary anchor-word time. Hard to repro because of the `< 0.01` window.
- **Fix sketch**: Track resolved anchor keys in a ref so each beat is re-resolved at most once per transcript-version, OR widen the tolerance and snapshot the resolved value next to the anchor on the item itself.

## 11. Drag-drop import loop runs after unmount

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/plugins/artist/sub_media_studio/MediaStudioPage.tsx:124-157`
- **Scenario**: `useEffect` consumes `pendingMediaStudioAssets` and kicks off an async loop that calls `addItem` per asset. If the user navigates away (Artist tab → Brain tab) mid-loop, the page unmounts but the IIFE keeps awaiting `artistProbeMedia` and calling `addItem`. `addItem` writes to the global Zustand store, so it succeeds — items appear when the user comes back, but probably attached to a stale composition (post-Open it'll merge with the new one, scrambling timestamps).
- **Root cause**: No `AbortController` / cancelled-flag in the effect.
- **Impact**: Items appear on the wrong composition after rapid tab-switching. Worst case: imports interleave with a Save and corrupt the autosave.
- **Fix sketch**: Capture a `cancelled` ref, check it before each `addItem`. On cleanup, set `cancelled.current = true`.

## 12. Whisper output overwrites any sibling `{stem}.json`

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/artist/transcribe.rs:247, 344`
- **Scenario**: For input `/clips/talk.mp4`, whisper writes `/clips/talk.json` (line 247), the code parses it, then silently `remove_file`s it (line 344). If the user already had a hand-edited `talk.json` (script notes, AnimateDiff prompt, anything) sitting next to the clip, it gets overwritten then deleted with no prompt, no backup, no error.
- **Root cause**: Code assumes `{stem}.json` is whisper-owned; in practice `.json` next to `.mp4` is a common pattern.
- **Impact**: Silent user-data destruction. Worst when users keep AI-prompt JSON beside renders.
- **Fix sketch**: Pass `--output_dir` pointing at a tempdir (already partially done — but tempdir, not `parent`), then move/rename into place. Or check `whisper_json_path.exists()` before invoking whisper and refuse to run if it does.

## 13. `validate_local_file_path` is incomplete on Windows

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/artist/transcribe.rs:98-131`
- **Scenario**: The validator misses: (a) Windows reserved device names — `CON`, `PRN`, `AUX`, `NUL`, `COM1`, `LPT1` (with or without extension) which open the device when ffmpeg/whisper tries to read them; (b) trailing-dot/space short names (`talk.mp4 `) that resolve to different files than the canonical form; (c) Win32 "namespace prefix" `\\?\C:\…` which bypasses the UNC check (starts with `\\?` not `\\`); (d) symlinks that pass shape but resolve to outside-app paths.
- **Root cause**: Validation is shape-based, not canonicalize-then-contain.
- **Impact**: A user with a corrupt `.mstudio.json` (or attacker-supplied) can escape the path filter.
- **Fix sketch**: Use `tokio::fs::canonicalize` and assert the result is under one of: app data dir, picked-folder root, or the Documents/Personas Media Studio default. Also reject Win32 reserved-device basenames.

## 14. Schema policy treats version 0 / missing as legitimate "older"

- **Severity**: low
- **Category**: schema-bypass
- **File**: `src-tauri/src/commands/artist/schema_policy.rs:69-76`
- **Scenario**: If a payload deserializes with a default `schema_version: 0` (because the field was absent in a hand-written JSON), `classify(0, 1)` returns `OlderNeedsMigration` and the load proceeds permissively. There is no "version-field-was-required" gate.
- **Root cause**: serde defaults erase the distinction between "intentionally v0" and "field missing entirely".
- **Impact**: Malformed user files load silently; downstream code that assumes pre-migration shape may panic later, deeper, with worse stack traces.
- **Fix sketch**: Read the version field as `Option<u32>` at parse time and treat `None` as `Unknown` → log-and-ignore. Or use `#[serde(default = "fail")]` to force presence.

## 15. ffmpeg progress regex eats malformed lines silently

- **Severity**: low
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/artist/ffmpeg.rs:1122-1135`
- **Scenario**: `parse_ffmpeg_time` returns `None` on any line that doesn't match `time=HH:MM:SS.ms`. ffmpeg's i18n builds and some Windows builds emit `time=N/A` during the warm-up second, and during xfade transitions emit malformed timestamps for a frame or two. Each `None` is silently dropped — no progress event is emitted but the line still reaches the user via `emit_line`. Combined with a stuck transcode (e.g. the `-loop 1` case in #5), the UI's progress bar can sit at 0% forever while the encode still finishes.
- **Root cause**: Progress is treated as best-effort but the UI's status banner ("Exporting…") is gated only on the `media_export_status` event; users with no progress see a hung UI.
- **Impact**: Confused users cancel real exports thinking they're stuck. Reproducible on long clips with multiple xfades.
- **Fix sketch**: Detect `time=N/A` explicitly and emit a "warming-up" status. Heartbeat a progress event every 2s based on stderr-line activity, even when no time= is parsed.
