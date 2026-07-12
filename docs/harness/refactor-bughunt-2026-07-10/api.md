> Context: api
> Total: 7
> Critical: 0  High: 0  Medium: 3  Low: 4

## 1. drive rename target allows `.` / `..` → parent-directory escape
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src/api/drive.ts:54-62 (`validateRenameTarget`), used by `driveRename` :145-149
- **Scenario**: A prompt-injected persona tool call (or a bad UI edit) does `driveRename("notes/todo.txt", "..")`. `validateRenameTarget` only rejects empty, path separators (`/`,`\`), and NUL — it does NOT reject the literal names `"."` or `".."`. So `".."` passes as a "simple file name" and crosses the IPC boundary; the backend renames `notes/todo.txt` to `notes/..`, which resolves to the sandbox root's parent (an escape/clobber).
- **Root cause**: The file's whole stated purpose (see header comment lines 9-15, 42-45) is first-line defense so bad calls "never cross IPC". `validateRelPath`/`validateNonRootRelPath` both guard `..` segments, but the rename path uses a *separate* validator that forgot the dot-segment check.
- **Impact**: security / data corruption — traversal outside the managed root on the rename op (mitigated only by the backend's own guard, which this layer is designed not to depend on).
- **Fix sketch**: In `validateRenameTarget`, after the separator/NUL check add: `if (newName === '.' || newName === '..') throw new Error('drive: rename target cannot be "." or ".."')`.

## 2. runDirectorBatch: 30-min timeout not on the blocking-mutation list → post-timeout retry re-runs LLM spend
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: at-least-once
- **File**: src/api/director.ts:105,136-142 (`runDirectorBatch`, `DIRECTOR_BATCH_TIMEOUT_MS = 1_800_000`)
- **Scenario**: A large fleet batch runs the Director sequentially over every persona and can exceed 30 min. When the explicit 30-min timeout fires, `invokeWithTimeout` rejects with `InvokeTimeoutError` but (per tauriInvoke.ts:468-479) does NOT cancel the backend — the batch keeps evaluating personas and committing verdicts. If the UI/user retries, the whole batch re-runs from the top, re-evaluating already-scored personas and double-charging LLM cost.
- **Root cause**: `run_director_batch` is a blocking mutating command with no server-side idempotency/dedup, but it relies on a plain explicit timeout instead of being registered in `BLOCKING_MUTATION_TIMEOUTS` (which is the documented mechanism that makes the IPC *wait* for the real result). Single-target `runDirectorOnPersona` is bounded by the 360s backend ceiling < its 7-min timeout, so it's safe; the batch has no such ceiling.
- **Impact**: money (duplicate LLM evaluation spend) + wasted work on retry.
- **Fix sketch**: Either add server-side batch dedup, or move `run_director_batch` onto `BLOCKING_MUTATION_TIMEOUTS` with `LONG_MUTATION_TIMEOUT_MS` so a slow batch waits instead of orphaning; and mark the UI retry as "still working" rather than re-dispatch.

## 3. Empty relPath bypasses all client validation for write/read ops
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/api/drive.ts:17-41 (`validateRelPath`, early-return on line 21)
- **Scenario**: `validateRelPath('')` returns immediately (`empty == managed root`) before any checks. `driveWriteText('', text)`, `driveMkdir('')`, `driveRead('')` therefore forward an empty path that the backend interprets as the sandbox root — e.g. writing a file *at* the root directory path or reading the root as a file. No client-side guard catches this; only delete has a root guard (`validateNonRootRelPath`).
- **Root cause**: The empty-string fast path was written for `driveList('')` (list the root, legitimate) but is shared by every op including destructive/write ops that shouldn't target the root itself.
- **Impact**: UX/error-surfacing (backend rejects, but the "never cross IPC" contract is broken); minor risk of an unexpected root-level write.
- **Fix sketch**: Add a `validateNonRootRelPath`-style guard on the write/mkdir paths, or have `validateRelPath` accept an `allowRoot` flag that write callers pass `false`.

## 4. director.ts re-declares generated ts-rs bindings inline (ValueRollup, ModelValueShare)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/api/director.ts:42-62 (`ModelValueShare`, `ValueRollup`)
- **Scenario**: These two interfaces are hand-copied inline while canonical generated bindings already exist and match field-for-field: `src/lib/bindings/ValueRollup.ts` and `src/lib/bindings/ModelValueShare.ts` (verified — same fields incl. `costPerValueDelivered: number | null`, `models: ModelValueShare[]`). The file comment (lines 38-40) even acknowledges the bindings exist. `ModelValueShare` is imported from the binding by `ValueRollup.ts`, so the generated pair is the real source of truth.
- **Root cause**: Convention drift — the file predates the ts-rs bindings and kept its inline shapes "to match existing convention," so a future Rust field change regenerates the binding but silently leaves the director.ts copy stale (compiles clean, wrong at runtime).
- **Impact**: maintainability + latent correctness (silent type drift on a money/value rollup).
- **Fix sketch**: Replace the inline `ModelValueShare`/`ValueRollup` with `import type { ValueRollup } from '@/lib/bindings/ValueRollup'` etc.; keep only the shapes that genuinely lack a binding (DirectorPortfolio, DirectorRosterEntry — confirmed no binding exists).

## 5. companion.ts is a 1765-line god-module spanning ~15 feature areas
- **Lens**: code-refactor
- **Severity**: low
- **Category**: oversized-module
- **File**: src/api/companion.ts:1-1765
- **Scenario**: One file bundles the IPC surface + types for TTS (Kokoro/Pocket), STT/whisper, sensory toggles, brain viewer, consolidation/reflection, proactive messaging, dashboard, cockpit, chat-cards, connectors, plugin toggles, project registry, jobs, approvals, and conversations. Section-comment banners already delineate these seams.
- **Root cause**: Every new companion phase appended to the single api module instead of splitting by sub-domain (the UI is already organized under `sub_voice/`, `sub_cockpit/`, `sub_dashboard/`).
- **Impact**: maintainability — hard to navigate, wide blast radius on edits, noisy diffs/merges.
- **Fix sketch**: Split along the existing banners into `api/companion/{tts,stt,brain,proactive,cockpit,jobs}.ts` and re-export from a barrel `api/companion/index.ts` to preserve import paths.

## 6. KokoroInstallProgress and PocketInstallProgress are identical duplicated types
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/api/companion.ts:383-388 (`KokoroInstallProgress`) and 440-445 (`PocketInstallProgress`)
- **Scenario**: Both interfaces have byte-for-byte identical fields (`phase` union, `bytesDownloaded`, `bytesTotal`, `error`) — the Pocket one's own doc comment says "Same shape and semantics as `KokoroInstallProgress`." Consumed by `sub_voice/KokoroVoicePanel.tsx` and `sub_voice/PocketVoicePanel.tsx`.
- **Root cause**: Copy-paste when Pocket TTS was added rather than reusing the existing type.
- **Impact**: maintainability — the two `phase` unions can silently diverge.
- **Fix sketch**: Define one `SidecarInstallProgress` and alias both (`export type KokoroInstallProgress = SidecarInstallProgress;`), or export the shared type and update both panels.

## 7. companionTts `credentialId` is a descoped-ElevenLabs leftover carried through the signature
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/api/companion.ts:323-337 (`companionTts`), plus the `TtsAudio.mimeType` "elevenlabs" note (290) and the descope comment (302)
- **Scenario**: ElevenLabs + Piper were descoped 2026-07-10 (per the `TtsEngineId` comment); the only live engines are `kokoro`/`pocket_tts`. `companionTts` still takes `credentialId: string | null`, forwards it over IPC, and the doc admits the backend ignores it — callers pass `null`. It's a required positional param wedged between `text` and `voiceId`.
- **Root cause**: The signature was frozen "for call-site shape stability" during descope, so a now-inert argument persists in the public API.
- **Impact**: maintainability — confusing dead parameter on a core call; awkward positional ordering.
- **Fix sketch**: Drop `credentialId` from `companionTts` (and stop forwarding it), updating the handful of call sites; leave the backend arg optional if it must stay wire-compatible.
