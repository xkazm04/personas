# api — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 1 medium / 1 low)
> Context group: Core Libraries & State | Files read: 12 | Missing: 0

## 1. Drive file bytes cross IPC as JSON number arrays (`number[]` / `Array.from(Uint8Array)`)
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/api/drive.ts:127-137
- **Scenario**: `driveRead` types the result as `number[]` and `driveWrite` sends `Array.from(content)`. Every byte becomes a JSON number ("137,80,78,71,…"), so a 3 MB image serializes to ~10-12 MB of JSON that WebView2 must stringify/parse and the JS side must hold as a boxed-number array before converting back to a `Uint8Array`. This is a hot path: `useLazyImageThumb` calls `driveRead(path)` per visible grid thumbnail (full file bytes just to render a thumb), `DriveImageLightbox` reads the full image on every navigation, and `DrivePage` uploads via `driveWrite`.
- **Root cause**: The wrapper predates use of Tauri v2's raw-byte IPC support; the byte payload is treated like any other serde JSON argument.
- **Impact**: ~3-4x transfer size plus double parse/allocation cost on every file preview, thumbnail, and upload — visible jank and memory spikes in the Drive plugin as file sizes grow (photos, PDFs).
- **Fix sketch**: On the Rust side have `drive_read` return `tauri::ipc::Response::new(bytes)` so `invoke` resolves to an `ArrayBuffer`; change `driveRead` to `invoke<ArrayBuffer>` and hand callers a `Uint8Array` view. For `drive_write`, accept the raw request body (`tauri::ipc::Request` / `InvokeBody::Raw`) or base64 instead of `Vec<u8>`-from-JSON-array. Longer term, add a `drive_thumbnail(relPath, maxDim)` command so the grid never ships full-size originals (cross-context: `useLazyImageThumb`).

## 2. companion.ts is a 1,770-line god module spanning ~15 unrelated IPC domains
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/api/companion.ts:1
- **Scenario**: Any change to one companion surface (say a new TTS engine field) touches the same file as chat turns, STT, sensory privacy gates, brain viewer, consolidation, proactive messaging, dashboard/cockpit specs, connectors, plugin toggles, and background jobs — code review diffs and merge conflicts all funnel through one file.
- **Root cause**: Every new companion phase (Phase 2 sensory, Phase 3 approvals, Phase C consolidation, Phase E proactive, Phase F dashboard/cockpit/connectors, Phase G jobs, Kokoro/Pocket/Whisper voice stacks) appended to the original file instead of getting its own module. It is now ~10x larger than any sibling in src/api/.
- **Impact**: Real maintenance hazard on the most actively developed surface in the app: hard to navigate, high conflict rate, and importers pull one flat namespace where ~90 exports live. No runtime cost (tree-shaking handles it), purely structural.
- **Fix sketch**: Split into `src/api/companion/` submodules along the existing section comments — e.g. `chat.ts` (init/send/interrupt/conversations), `voice.ts` (TTS engines + STT), `sensory.ts`, `brain.ts` (brain viewer + consolidation + reflections), `proactive.ts`, `surfaces.ts` (dashboard/cockpit/chat-cards/connectors/plugins), `jobs.ts`, `events.ts` (the `companion://*` constants + payload types) — with an `index.ts` barrel re-exporting everything so all existing `@/api/companion` imports keep compiling unchanged. Pure file move, no behavior change.

## 3. Dead `DirectorSeverity`/`DirectorCategory` exports triplicate the ts-rs bindings
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/api/director.ts:7-15
- **Scenario**: `DirectorSeverity` and `DirectorCategory` are exported from `@/api/director` but no file in src/ imports them from there (verified by grep); meanwhile the same unions exist as generated bindings (`src/lib/bindings/DirectorSeverity.ts`, `DirectorCategory.ts`) and a third hand-written copy lives in `src/features/overview/sub_director/categoryMeta.ts:15`.
- **Root cause**: The file's own header (lines 3-5) says these inline mirrors were temporary "until ts-rs bindings land" — the bindings landed (the file already re-exports `ValueRollup`/`ModelValueShare` from bindings) but these two were never removed.
- **Impact**: Three definitions of the same Rust enum can drift independently (adding a category on the Rust side updates the binding but not `categoryMeta.ts`'s copy, which silently falls back to `FALLBACK` meta). Minor, but exactly the drift this file's convention was designed to prevent.
- **Fix sketch**: Delete the two unused type declarations from src/api/director.ts (or convert them to `export type { … } from '@/lib/bindings/…'` re-exports matching the ValueRollup pattern), and have `sub_director/categoryMeta.ts` import `DirectorCategory` from the bindings instead of redeclaring it. Verify with tsc; no runtime change.
