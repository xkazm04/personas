# Bug Hunter — Cockpit, Voice & Sensory

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: cockpit-voice-sensory | Group: Athena Companion

## 1. Main TTS reply playback has no handle — consecutive turns talk over each other
- **Severity**: Critical
- **Category**: Race condition / overlapping audio
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:1620`
- **Scenario**: The "real reply" branch does `const { done } = playAudio(url)` and throws away the returned `audio` element — only `done` is kept. There is *no* `mainAudioRef`. The composer is explicitly non-blocking ("a message typed while a turn is still streaming is classified", line ~1653), and autonomous mode + voice-turn requests can also fire turns back-to-back. When reply B's audio starts while reply A's clip is still playing, nothing pauses A. `stopProgressAudio()` (line 1610) only pauses `progressAudioRef` (ack/heartbeat clips), never the main reply element. Two (or more) of Athena's spoken answers play simultaneously.
- **Root cause**: Asymmetry in the playback model: the progress channel is "exclusive" with a ref + `stopProgressAudio()`, but the main reply channel was never given the same single-owner discipline. The `play()` helper in `voicePlayback.ts:46` deliberately "returns the active element so callers can pause it (e.g. when the user closes the panel mid-speech)" — but this caller drops it on the floor.
- **Impact**: Garbled overlapping speech on any rapid two-turn / autonomous-beat-then-turn sequence; the user cannot stop a long spoken reply; volume/level analyser sees mixed streams. Worsens with Piper (larger WAV, longer playback window).
- **Fix sketch**: Add `mainAudioRef` mirroring `progressAudioRef`; before starting a new main clip (and on panel close / new send), call `mainAudioRef.current?.pause()` and revoke its URL. Capture `const { audio, done } = playAudio(url)` and store `audio` in the ref.

## 2. Main reply object URLs are never revoked — unbounded blob memory leak per turn
- **Severity**: High
- **Category**: Latent failure / resource (memory) leak
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:1618`
- **Scenario**: For every spoken reply, `synthesizeTts(...)` → `URL.createObjectURL(blob)` (voicePlayback.ts:36) and the url is handed to `setPlaybackAudioUrl(url)` + `playAudio(url)`. On the normal completion path only `markPlaybackPlayed()` is called — `URL.revokeObjectURL` is never invoked for this url. The progress-clip path *does* revoke (lines 1480/1497/1505), proving the omission is specific to the main channel. `voicePlayback.ts`'s own header even admits "Caller is responsible for `URL.revokeObjectURL` when discarding (currently we let the page unload do it…)". In a long-lived Tauri webview that "page unload" effectively never happens.
- **Root cause**: Object-URL ownership was assigned to the store record (`audioUrl`) for the Replay feature, but no lifecycle owner revokes it when the record is replaced by the next turn's playback.
- **Impact**: Each spoken turn leaks one blob (ElevenLabs ~50 KB, Piper WAV ~150–300 KB). Over a long voice session that's tens of MB of unreclaimable blob memory plus the decoded audio buffers, in a desktop app expected to run for hours.
- **Fix sketch**: When replacing `pendingPlayback`/`audioUrl`, revoke the previous record's `audioUrl`; on panel unmount revoke any outstanding url. Tie revocation to the same ref introduced in finding #1.

## 3. STT `getUserMedia` permission prompt can leave the hold-to-talk UI stuck in "listening"
- **Severity**: High
- **Category**: Race condition / latent stuck-state
- **File**: `src/features/plugins/companion/useLocalDictation.ts:117`
- **Scenario**: `start()` calls `getUserMedia(...).then(...)` which only sets `listening=true` *after* the user grants the mic permission — that prompt can take seconds. Meanwhile `useHoldToTalk` already set `talking=true` synchronously (useHoldToTalk.ts:57). If the user releases the button (calls `stop()`) before the permission promise resolves, `useLocalDictation.stop()` early-returns because `listening` is still false (line 193: `if (!listening) return`). Then the promise resolves, sets `listening=true`, and the mic is now live with no listener watching for the stop — the orb stays in the listening visual and the mic stays open until the next manual stop. The mirror case (permission denied) is handled, but the "resolved after stop" case is not.
- **Root cause**: `start()` arms the stream asynchronously but there is no "cancelled before stream arrived" flag; `stop()` keys off `listening`, which lags the real intent by the duration of the permission/promise.
- **Impact**: Mic left recording with no UI affordance to stop it (privacy + the orb stuck "listening"); on slow permission prompts a tap-and-release silently arms an orphan capture. Combined with #4, that orphan capture is also discarded if eventually torn down.
- **Fix sketch**: Add a `cancelledRef` set in `stop()`/`abort()`/teardown; in the `getUserMedia` `.then`, if cancelled, immediately `stream.getTracks().forEach(t=>t.stop())` and bail instead of going live. Alternatively gate on a generation counter incremented per `start()`.

## 4. STT `start()` while `listening` is false but a capture is mid-teardown drops audio silently
- **Severity**: Medium
- **Category**: Silent failure / edge case
- **File**: `src/features/plugins/companion/useLocalDictation.ts:158`
- **Scenario**: `finishAndTranscribe()` snapshots `chunksRef`, clears it, and calls `teardown()` *synchronously*, then kicks off the async `companionSttTranscribe`. `listening` only flips false in the `.finally()` after the network round-trip. During that transcription window the empty-audio guard `if (total === 0 || !model) { setListening(false); return; }` (line 169) silently swallows a capture that produced zero samples — e.g. the user tapped-and-released faster than one 4096-sample `onaudioprocess` callback (~256 ms at 16 kHz), or the mic delivered silence. No `error` is set, `finalText` stays empty, and `useHoldToTalk`'s end effect sees `text` empty → fires no turn and gives no feedback. The user said something (or thinks they did) and nothing happens, with no "didn't catch that" message.
- **Root cause**: Empty/short capture is treated as a normal no-op rather than a user-facing "couldn't hear you" condition; there's no minimum-duration or silence-detection feedback boundary in the renderer.
- **Impact**: Silent dead-air on short or silent taps — looks like the feature is broken/ignoring the user. Especially likely with quick utterances and the ScriptProcessor's coarse 4096-frame buffering.
- **Fix sketch**: When `total === 0` (or below a min-samples threshold), set a user-visible `error` like `no_audio_captured` instead of silently returning, so the hold-to-talk consumer can surface a transient "I didn't catch that" hint.

## 5. Whisper transcript success theater — engine exit 0 with empty/garbage stdout returns a blank transcript as success
- **Severity**: Low
- **Category**: Silent failure
- **File**: `src-tauri/src/companion/stt/whisper.rs:196`
- **Scenario**: `transcribe()` checks `output.status.success()` and, on success, runs `clean_transcript(&stdout)` and returns it verbatim. whisper-cli can exit 0 yet print nothing useful — e.g. an all-silence WAV, a model/audio sample-rate edge case, or `-np` suppressing the only diagnostic line. `clean_transcript` happily returns an empty string, which propagates up as a successful `""` transcript. The frontend (`useLocalDictation` line 184) does `setFinalText(text.trim())` and `useHoldToTalk` treats empty as "no turn" — so a genuinely failed transcription is indistinguishable from "user said nothing", and any whisper-only stderr warning that didn't fail the process is discarded (stderr is only read on the non-success branch, lines 183–194).
- **Root cause**: The contract assumes exit 0 ⇒ valid transcript; it never inspects whether stdout actually contained text, and stderr is ignored on the success path.
- **Impact**: Occasional "I spoke but Athena did nothing" with zero logging to diagnose; legitimate engine warnings on the success path are dropped. Low because audio-length/WAV validation already filters most empty inputs upstream.
- **Fix sketch**: On exit 0 with an empty `clean_transcript`, log stderr at warn level and return a typed "no speech detected" signal the frontend can surface, rather than an empty success string indistinguishable from silence.
