# Companion

Companion is the Athena assistant plugin. It has two UI surfaces: a plugin settings page and the always-available companion panel/footer affordance.

## User surface

| Surface | Behavior | Main files |
| --- | --- | --- |
| Plugin page | Three-tab manager for Setup, Memory, Voice | `CompanionPluginPage.tsx` |
| Setup | Global toggles such as footer icon visibility, chime, and beta self-improve exposure | `sub_setup/SetupPanel.tsx`, `companionPluginSlice.ts` |
| Memory | Full-page brain viewer over episodes, doctrine, identity, and constitution | `sub_memory/MemoryPanel.tsx`, `BrainViewer.tsx` |
| Voice | ElevenLabs credential picker and voice-id binding | `sub_voice/VoicePanel.tsx`, `commands/companion/voice.rs` |
| Panel | Chat, streaming, quick replies, approvals, playback | `CompanionPanel.tsx`, `CompanionToolbar.tsx`, `ApprovalCard.tsx` |
| Avatar/footer | Athena visual state, footer icon, chime, pending playback | `AthenaAvatar.tsx`, `CompanionFooterIcon.tsx`, `chime.ts`, `voicePlayback.ts` |

## Athena desktop-aware lineage

Companion's awareness of the user's desktop activity ships in phases. The decision-gate audit lives at [`../../architecture/athena-phase1-audit.md`](../../architecture/athena-phase1-audit.md); the two shipped feature deliverables sit alongside this README:

- [`athena-daemon-bridge.md`](./athena-daemon-bridge.md) — Phase 3 c v3. Cross-process `ambient_signal` SQL projection so daemon-fired personas see the same in-memory ambient window the windowed app captures (clipboard, app focus, file changes).
- [`athena-cli-session-awareness.md`](./athena-cli-session-awareness.md) — Phase 5 v1. Read-only injection of the user's active interactive Claude CLI session into a persona's prompt, gated by per-persona toggle (Settings tab) AND global toggle (Companion → Setup → Sensory signals).

## Initialization and brain storage

`companionInit()` calls `companion_init` once per browser lifetime using a `globalThis` promise slot so StrictMode and Vite HMR cannot double-ingest doctrine. The backend initializes `~/.personas/companion-brain/` and starts doctrine ingestion in the background when the `ml` feature is available.

Manual re-ingest uses `companion_reingest_doctrine`. It is idempotent: unchanged chunks are skipped by content hash, and the frontend receives inserted/updated/unchanged/deleted counts.

## Conversation flow

1. Frontend sends `companion_send_message` with the user message and a `voiceEnabled` flag.
2. Backend drives the companion runtime and streams progress through `companion://stream`.
3. Final response returns user/assistant episode IDs, quick-reply labels, and optional `ttsText`.
4. The panel appends messages to `companionStore.ts`; pending playback is stored globally so the footer Play button and chat panel coordinate.
5. `companion_reset_conversation` clears the persistent Claude CLI session and can optionally wipe the SQL transcript. Markdown episodes remain on disk.

## Approvals and navigation

Athena actions can create pending approvals. The panel lists them through `companion_list_pending_approvals` and resolves them through `companion_approve_action` or `companion_reject_action`.

Events:

- `companion://approvals`: newly created approval rows.
- `companion://navigate`: direct route switch requested by Athena.
- `companion://stream`: streaming turn output from the backend.

Approval outcomes may include a client-side action such as `{ type: "navigate", route }`.

## Voice

Voice playback dispatches to one of two engines, picked by the user in the Voice tab's engine selector. The slice persists `companionVoiceEngine: 'elevenlabs' | 'piper'`; per-engine identity (credential, voice id) lives in dedicated slice fields so switching engines doesn't clobber the other side's last selection.

Backend code lives under `src-tauri/src/companion/tts/` with one submodule per engine; `commands/companion/voice.rs` is a thin dispatcher that validates input (text length, voice-id format) and routes to the right impl.

### ElevenLabs (cloud)

Backend proxy: the frontend sends text + credential id + voice id + tuning settings to `companion_tts`; the backend reads the decrypted Vault credential, calls ElevenLabs, and returns base64 MP3 (`audio/mpeg`) plus MIME metadata. API keys do not cross into the webview. Allowlist of model ids is server-side (`tts/elevenlabs.rs::TTS_ALLOWED_MODELS`).

### Piper (local)

Local synthesis via the official rhasspy/piper binary as a subprocess. No network at synth time; no credential needed. Two preconditions:

1. **Engine binary** at `~/.personas/companion-tts/bin/piper(.exe)` (or `PERSONAS_PIPER_BIN` override, or on PATH). The Voice tab surfaces an Installed/Not-installed badge plus the expected install path; users drop the official Piper release zip's `piper.exe` (Windows) or `piper` binary (mac/Linux) into that path. Status is reported by `companion_tts_piper_engine_status`.

2. **Voice model** under `~/.personas/companion-tts/piper/<voice-id>/` containing `<voice-id>.onnx` + `<voice-id>.onnx.json`. Voices are picked from a curated catalog (`tts/catalog.rs::PIPER_VOICES`, ~17 voices spanning 14 languages) and downloaded from `huggingface.co/rhasspy/piper-voices` via `companion_tts_download_piper_voice`. Atomic via `.partial` rename. Progress streams on the `companion://tts-download` event channel (throttled to 250ms / 1MB increments). `companion_tts_list_piper_voices` returns the catalog with each row's `isDownloaded` checked from disk; `companion_tts_delete_piper_voice` removes a voice's directory tree.

Synthesis spawns piper with `--model voice.onnx --config voice.onnx.json --output_file <tempfile>`, writes the text on stdin, and reads the resulting WAV from disk. Result: `audio/wav` base64 plus MIME metadata (note the difference from ElevenLabs' MP3 — both are HTML5 `<audio>`-decodable, no frontend sniffing needed).

**Why subprocess instead of in-process bindings?** The published `piper-rs` crate pins `ort = "=2.0.0-rc.11"` while we ship `2.0.0-rc.9` for fastembed. Two ORT versions in one process is a recipe for the same DLL-version-mismatch panic Cargo.toml warns about. Subprocess isolation gives us the official Piper Windows release (with its bundled `onnxruntime.dll`) without touching our ML stack. The cost is per-call subprocess overhead (~50–100ms), well under the synthesis time of even a one-sentence reply.

### Language coverage UX

The Piper voice browser groups voices by BCP-47 language. The user's current app locale is matched against voice prefixes (`en` matches `en-US` / `en-GB`, `cs` matches `cs-CZ`); matching groups are promoted to the top with a "Your language" badge. When no Piper voice covers the user's locale, the panel surfaces a fallback callout pointing them at ElevenLabs.

## Self-improve loop

When beta self-improve is enabled, `companion_request_improvement` runs a coding CLI session against user feedback. The result reports success, summary, modified files, critical files, elapsed time, and any error. Startup recovery checks for orphaned runs after Tauri dev reloads.

## State

`src/features/plugins/companion/companionStore.ts` owns panel state, init status, messages, streaming text, approvals, quick replies, brain viewer cursor, self-improve state, and pending playback. `companionPluginSlice.ts` owns the plugin page tab and persistent plugin-level settings.
