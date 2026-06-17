# Test Mastery — Cockpit, Voice & Sensory
> Total: 7 findings (0 critical, 4 high, 3 medium, 0 low)

> Stack note: Rust validation/catalog/downloader helpers in this context are unusually well-tested (`tts/mod.rs`, `stt/mod.rs`, both `catalog.rs`, both `downloader.rs` each carry `#[cfg(test)]` modules; `ambient_context.rs` has 55 tests covering the sensory engine). The real gaps cluster at the *seams* the tests skip: the ElevenLabs settings builder (inline + HTTP-bound, never unit-tested), the command-layer privacy choreography, and the React panels (zero tests for `PiperVoicePanel`/`SttPanel`/`CockpitPanel` despite a working vitest + Testing Library + zustand harness next door).

## 1. ElevenLabs request-shaping (model allowlist, clamps, conditional fields) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/tts/elevenlabs.rs:60-101
- **Current test state**: none
- **Scenario**: All payload-shaping logic for a *paid* cloud API lives inline in `synthesize()`: the `TTS_ALLOWED_MODELS` rejection, the `eleven_turbo_v2_5` fallback when `model_id` is empty/absent, `stability`/`similarity` `clamp(0.0,1.0)`, `speed.clamp(0.7,1.2)`, `style.clamp(0.0,1.0)`, and the rule that `speed`/`style` are *only* added to `voice_settings` when the user opted in. A regression — dropping the model allowlist, inverting a clamp, or always emitting `speed`/`style` — ships a malformed/over-permissive request straight to a billed endpoint and no test fires.
- **Root cause**: the logic is welded to `synthesize()`, which needs a vault credential + live HTTP, so it can't be exercised by a unit test as written. Nothing isolates the pure transform.
- **Impact**: a bad model id surfaces as an opaque upstream 422 (the allowlist exists precisely to prevent that); a broken clamp degrades audio quality or sends out-of-band values; always-emitting style/speed burns the byte band the comment says to avoid. All on a metered API.
- **Fix sketch**: extract a pure `build_voice_settings(settings: &TtsSettings) -> serde_json::Value` and `resolve_model_id(settings) -> Result<&str, AppError>` from `synthesize()`, then **LLM-generatable** batch over them. Invariants to assert (not snapshots): unknown `model_id` → `Err`; empty/None → `TTS_DEFAULT_MODEL`; each allowed model → echoed; out-of-band stability/similarity/speed/style → clamped to the documented band; `speed`/`style` keys *absent* when the field is `None`, *present* when `Some`.

## 2. Cockpit error-state vs empty-state distinction has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:42-46,175-199
- **Current test state**: none
- **Scenario**: The component deliberately keeps `error` separate from `spec===null` (see the load-bearing comment at line 42) so a first-boot fetch *failure* renders "Couldn't load your cockpit" + Retry, while a genuinely-never-composed cockpit renders the "your cockpit is empty / Talk to Athena" CTA. A refactor that collapses these back to `!spec` would show first-time users a confusing error+retry on a healthy empty state — the exact bug the comment warns against — and nothing catches it. The `COMPANION_COMPOSE_COCKPIT_EVENT` handler dropping the contextual overlay + refetching, and "contextual overlay wins over persistent spec" (line 110), are likewise unverified.
- **Root cause**: panel was never given a test; the branch precedence is subtle and comment-only.
- **Impact**: onboarding regression (broken empty-state CTA) or a stale/clobbered cockpit after Athena composes — both directly hit the companion's first-impression surface.
- **Fix sketch**: render-test with `companionGetCockpit` mocked. (a) reject → assert "Couldn't load" + Retry visible, empty-state CTA absent; (b) resolve `null` → assert empty-state CTA, no error; (c) resolve a spec → assert widgets render; (d) set `contextualCockpit` in `useSystemStore` → assert contextual title/banner win over a persistent spec. Mirror the `ActivityTray.test.tsx` store-driven pattern already in this repo.

## 3. `PiperVoicePanel` VoiceRow precedence ladder + delete-selected-voice are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/plugins/companion/sub_voice/PiperVoicePanel.tsx:152-171,389-396
- **Current test state**: none
- **Scenario**: Two business rules with explicit comments and zero tests. (a) `VoiceRow`'s derived-state ladder (lines 392-396) guarantees a stale `failed`/`queued` progress entry from an earlier attempt never overrides a freshly-downloaded `isDownloaded:true` after a catalog refresh — invert that and the row shows "Re-download" on an installed voice. (b) `onDelete` (lines 152-171): deleting the *currently-selected* voice must clear `piperVoiceId` AND flip `companionVoiceEnabled` off — otherwise playback stays "enabled" pointing at a deleted voice and synthesis silently fails. The locale-promotion sort/grouping in `groupedVoices` (lines 178-208) is also unverified.
- **Root cause**: panel never tested; the precedence and the enable-gate side effect are pure UI logic easy to break in a refactor.
- **Impact**: a voice toggle that claims "on" but points at nothing (silent TTS failure — the same trap `VoicePanel.onSwitch` guards against), or wrong download affordance confusing users into re-downloading 60-110 MB.
- **Fix sketch**: render-test `PiperVoicePanel` with `companionTtsListPiperVoices` mocked and `useSystemStore` seeded. Assert: a downloaded voice with a lingering `failed` progress entry still shows Select/Delete (not Re-download); deleting the selected voice clears the store's `companionPiperVoiceId` and sets `companionVoiceEnabled=false`; a voice matching `language` is sorted into the first group. Pure-function extraction of the sort would also make it **LLM-generatable**.

## 4. `companion_purge_sensory_source` re-enable choreography + cli_session cross-process gate untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/companion/sensory.rs:80-94,110-120
- **Current test state**: exists-but-weak (the underlying `ambient_context` engine is well-tested; the command-layer logic on top is not)
- **Scenario**: Two privacy-critical behaviors live only in the command layer. (a) `companion_purge_sensory_source` (110-120) reads `was_enabled`, toggles off (purges), then toggles back on *only if it was originally on* — so purge-without-disable must leave the gate exactly as it found it. If the re-enable guard inverts, a "clear what Athena sees" action silently *disables future capture* (or silently *enables* a source the user had off — a privacy violation). (b) `companion_set_sensory_source_enabled` (80-94) special-cases `source == "cli_session"` to persist the gate to `app_settings` so the daemon process honors it; if that branch breaks, the in-window UI says "off" but the cross-process daemon keeps reading CLI sessions.
- **Root cause**: the engine has 55 tests but the command wrappers add real logic (the toggle-off-then-on dance, the string-matched persistence branch) that those engine tests don't reach; commands need `State<AppState>` so they're skipped.
- **Impact**: silent privacy-gate drift between the UI and the daemon, or capture silently turned off after a purge — directly violates the documented "I disabled it, so it's gone too" / fail-closed contract.
- **Fix sketch**: factor the re-enable decision into a pure helper (`(was_enabled, purged) -> restore?`) and unit-test it; add an integration test (or test-double `AppState` with an in-memory pool) asserting: purge on an enabled source leaves `is_source_enabled==true`; purge on a disabled source leaves it `false`; `set_source_enabled("cli_session", true/false)` writes the matching `CLI_SESSION_AWARENESS_ENABLED` value to settings, and non-cli_session sources do *not* touch settings.

## 5. `SttPanel` download-failure and delete error-feedback paths untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/plugins/companion/sub_voice/SttPanel.tsx:169-203
- **Current test state**: none
- **Scenario**: `onDownload` (169-188) carries a deliberate guard (comment lines 177-180): if the invoke throws *before* any progress event, the row is flipped to `failed` with the message so it doesn't "sit on a queued spinner forever." `onDelete` (190-203) uses `toastCatch` (not `silentCatch`) specifically so a failed delete surfaces to the user ("phantom model" comment). Both are easy to silently regress to `silentCatch`/no-state-update, leaving the row stuck spinning or a delete that fails invisibly. Also `onDelete` clears `companionSttModelId` when deleting the selected model — same silent-misconfig risk as #3.
- **Root cause**: panel never tested; these are intentional error-UX choices encoded only in comments.
- **Impact**: a stuck "downloading" spinner with no recovery, or a model the user thinks they deleted still selected — voice input then silently misbehaves.
- **Fix sketch**: render-test `WhisperConfig` with `companionSttDownloadModel`/`companionSttDeleteModel` mocked to reject. Assert: rejected download flips the row to a failed affordance carrying the error; rejected delete triggers the toast path (spy `toastCatch` or assert the toast); deleting the selected model clears `companionSttModelId` in the store.

## 6. `formatRelative` / `prettyTime` are time- and locale-dependent with no deterministic test
- **Severity**: medium
- **Category**: flaky-nondeterministic
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:268-276 ; src/features/home/sub_cockpit/widgets/DecisionLogWidget.tsx:121-143
- **Current test state**: none (DecisionLogWidget has a test but it never renders a `timestamp`, so `prettyTime` is uncovered)
- **Scenario**: Both helpers branch on `Date.now()`/`new Date()` and call `toLocaleDateString`/`toLocaleTimeString` with the ambient locale. The "just now / Xm ago / Xh ago / date" boundaries (60s, 3600s, 86400s) and the `sameDay` branch have no test, and any test added without `vi.useFakeTimers()` + a pinned TZ/locale would be flaky across machines and CI timezones. The `Number.isNaN` fallback (bad ISO → return raw string) is also unverified.
- **Root cause**: helpers are inlined/not exported and never had a test; the existing DecisionLogWidget test omits timestamps.
- **Impact**: low blast radius (display only) but a real flakiness trap if someone adds a naive assertion later; the NaN-guard regressing would render "Invalid Date" in the UI.
- **Fix sketch**: export both helpers (or test via the rendered widget) under `vi.useFakeTimers()` with a fixed `setSystemTime` and a pinned locale/TZ. Assert each boundary (`59s`→"just now", `120s`→"2m ago", `2h`, yesterday→date), and that an unparseable ISO returns the input verbatim. **LLM-generatable** once exported.

## 7. `validate_wav_format` missing-fmt-chunk and odd-chunk-padding branches uncovered
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/stt/mod.rs:74-129
- **Current test state**: exists-but-weak (tests cover valid, non-WAV, stereo, truncated — but not all reject branches or the chunk-walk)
- **Scenario**: The chunk walker is the gate that stops a non-WAV/partial mic capture from reaching whisper.cpp and transcribing to garbage (bug-hunt 2026-06-07 #6). Untested branches: a RIFF/WAVE file with a `data` chunk but **no `fmt ` chunk** (`!fmt_ok` → must reject), wrong sample rate / non-PCM / 8-bit (each its own `err`), the `data_len < 32` "no meaningful samples" reject, and the odd-`chunk_size` word-alignment pad-byte skip (`pos = body_end + (chunk_size & 1)`) — an off-by-one there would misparse any real WAV with a leading odd-sized metadata chunk and reject valid audio.
- **Root cause**: the existing test set picked the obvious cases; the bounds-checked walk has several independent reject paths and an alignment subtlety that no fixture exercises.
- **Impact**: either garbage transcription slips through (a reject branch silently weakens) or valid audio from real recorders (with LIST/odd chunks) gets rejected as "not audio" — both degrade the core voice-input promise.
- **Fix sketch**: extend the existing `#[cfg(test)] mod tests`. **LLM-generatable** fixture batch: a WAVE with only a `data` chunk (no fmt) → Err "missing a PCM fmt chunk"; 8 kHz / 8-bit / 2-byte fmt-too-short variants → Err; a `data` chunk of <32 bytes → Err "no meaningful sample data"; a valid WAV with a preceding odd-length `LIST` chunk → Ok (pins the pad-byte alignment).
