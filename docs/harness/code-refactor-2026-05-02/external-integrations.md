# Code Refactor Scan — External Integrations

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~38

## Summary

External Integrations are in reasonably good shape — TypeScript wrappers are thin, validation boundaries are documented thoughtfully (e.g. `drive.ts` `validateRelPath`, `signing.ts` sensitive-path guard), and most exports trace through to consumers. However, three patterns repeat across the surface: (1) **dead exports left behind after consolidation** — the OCR plugin was retired and its callers moved into `drive.ts`, but the original `@/api/ocr` module still exposes 4 unused commands and the `signing` module ships 2 unused sidecar helpers; (2) **a duplicated `safeInvoke`/`isCommandNotFound` helper** lives in both `researchLab.ts` and `devTools.ts` — and the two copies have already drifted (devTools still has the broken substring check that researchLab explicitly fixed and warned about); (3) **structural inconsistency** — the GitLab integration UI lives at `features/gitlab/` while every other integration UI (drive, artist, twin, obsidian-brain, research-lab) lives under `features/plugins/`, and the global `NotificationCenter` is awkwardly nested inside `features/gitlab/components/` despite being mounted in `App.tsx` for non-GitLab notifications.

## 1. Dead OCR API surface left after the OCR plugin was retired

- **Severity**: high
- **Category**: dead-code
- **File**: src/api/ocr/index.ts:22-45
- **Scenario**: `drive.ts` line 138 explicitly comments "OCR (consolidated from the retired OCR plugin)" and exposes `ocrDriveFileGemini` / `ocrDriveFileClaude`. Of the 5 functions exported from `@/api/ocr/index.ts`, only `cancelOcrOperation` is still used (by `DriveOcrDrawer.tsx`). `ocrWithGemini`, `ocrWithClaude`, `listOcrDocuments`, and `deleteOcrDocument` have zero callers.
- **Root cause**: the consolidation moved the OCR-from-Drive happy path into `drive.ts` with a sandboxed `validateRelPath`, but did not delete the now-superseded absolute-path entry points from the old plugin.
- **Impact**: the absolute-path `ocr_with_gemini` IPC requires the frontend to pass `apiKey` (compare line 22-28 vs the consolidated drive variant which fetches the key from the vault server-side). Leaving these exports in place advertises a less-secure code path that any future feature might pick up by mistake. Also keeps the `OcrDocument` type bloated with fields (`structured_data`, `prompt`) the only remaining caller never reads.
- **Fix sketch**:
  - Delete `ocrWithGemini`, `ocrWithClaude`, `listOcrDocuments`, `deleteOcrDocument` from `src/api/ocr/index.ts`.
  - Move the surviving `cancelOcrOperation` and the `OcrDocument`/`OcrResult` types into `drive.ts` (or unify with `OcrDocumentLite`) so the whole `src/api/ocr/` folder can be retired.
  - Drop the matching command names from `commandNames.generated.ts` source-of-truth on the next regen.

## 2. Duplicated `safeInvoke` helper has already drifted between modules

- **Severity**: high
- **Category**: duplication
- **File**: src/api/researchLab/researchLab.ts:181-218 vs src/api/devTools/devTools.ts:23-46
- **Scenario**: Both modules define `isCommandNotFound` + `safeInvoke` with the same intent (return `fallback` when the Tauri backend hasn't shipped the command yet). The implementations have already diverged: `researchLab.ts` carries a 20-line comment explaining a historical bug where a substring `msg.includes("not found")` check swallowed real `not_found` errors and replaces it with a strict regex. `devTools.ts` line 35 still uses the old broken pattern (`msg.includes("not found") || msg.includes("Command") && msg.includes("not found")`).
- **Root cause**: helper was copy-pasted into the second module instead of extracted; the bug fix landed in only one copy.
- **Impact**: a real `dev_tools_*` "context not found" error today is silently coerced into a `safeInvoke` fallback (empty list / null project) by devTools.ts — exactly the bug researchLab.ts was hardened against. Future fixes in either file will keep diverging.
- **Fix sketch**:
  - Extract to `src/lib/tauri/safeInvoke.ts` (next to `tauriInvoke`) with the strict regex version.
  - Re-export from both `researchLab.ts` and `devTools.ts`, delete the local copies.
  - Add a one-line unit test pinning the substring-vs-regex contract so the bug can't regress a third time.

## 3. Unused signing sidecar helpers (replaced by drive equivalents)

- **Severity**: medium
- **Category**: dead-code
- **File**: src/api/signing/index.ts:112-116
- **Scenario**: `writeSidecarFile` and `readSidecarFile` invoke `write_sidecar_file` / `read_sidecar_file` IPCs and have zero callers anywhere in `src/`. The actual signing-plugin hook (`useSigning.ts:101, 123`) writes/reads sidecars via `driveWriteText` / `driveReadText` against the managed root.
- **Root cause**: early prototype likely used absolute-path sidecar IO before the Drive sandbox was wired in; the unused exports were never cleaned up.
- **Impact**: a future caller who imports these in good faith bypasses Drive's `validateRelPath` boundary entirely (signing's own `SENSITIVE_PATH_PATTERNS` only covers `signDocument`, not raw file IO).
- **Fix sketch**:
  - Delete the two exports from `src/api/signing/index.ts`.
  - Drop `write_sidecar_file` / `read_sidecar_file` from the generated command list.

## 4. Five additional dead `getX` exports across Twin and ResearchLab

- **Severity**: medium
- **Category**: dead-code
- **File**: src/api/twin/twin.ts:39-43, 94-95 + src/api/researchLab/researchLab.ts:227-228, 262-268
- **Scenario**: Project-wide grep shows no callers for `getProfile(id)`, `getActiveProfile()`, `getTone(twinId, channel)` (twin), and `getProject(id)`, `updateHypothesis(...)` (researchLab). All other CRUD methods on these resources are wired through stores or hooks, so these are not "in flight" for an upcoming feature — they are leftovers from an early scaffold pass.
- **Root cause**: API wrappers were generated against the Rust handler set, but only the list/create/delete subset is consumed by the UIs.
- **Impact**: bloats the IPC surface (and tier-usage attack surface — every exported wrapper is one more ambiguous tool a persona might invoke), and misleads future readers into thinking individual-fetch read paths exist when stores actually re-derive from list calls.
- **Fix sketch**:
  - Delete all five named exports.
  - If a future detail view actually needs single-record fetch, re-add at that point with a clear caller — don't speculatively retain.

## 5. Two unused Obsidian graph link helpers

- **Severity**: medium
- **Category**: dead-code
- **File**: src/api/obsidianBrain/index.ts:257-261
- **Scenario**: `obsidianGraphOutgoingLinks` and `obsidianGraphBacklinks` are exported but have zero callers across the codebase. The graph panel currently uses `obsidianGraphSearch`, `obsidianGraphListOrphans`, `obsidianGraphListMocs`, `obsidianGraphStats` — but never the per-note link traversal helpers.
- **Root cause**: shipped together with the rest of the Phase 7 graph block, anticipating a backlinks/forward-links UI that hasn't materialised.
- **Impact**: keeps two `obsidian_graph_*` IPC commands compiled into the desktop bundle on the Rust side and visible to persona tool dispatchers with no UI to validate them.
- **Fix sketch**:
  - Delete both exports (and their Rust counterparts on the next pass) until the linked-notes UI is actually scheduled.
  - If they're being kept "for the AI memory connector," wire them up — leaving them dangling is worse than either committing or deleting.

## 6. Global NotificationCenter is misfiled inside `features/gitlab/`

- **Severity**: medium
- **Category**: structure
- **File**: src/features/gitlab/components/NotificationCenter.tsx:278-369
- **Scenario**: `NotificationCenter` is the application-wide notification panel — it renders pipeline notifications, process completions, human review redirects, and feedback-chat session restoration, and is mounted unconditionally in `App.tsx:187`. It lives in `features/gitlab/components/` and imports from `./pipelineHelpers`, but it's used by 13 non-GitLab callers (chat, dev-tools, plugins, eventBridge, etc.).
- **Root cause**: it started life as the GitLab pipeline notification toast and absorbed every other process-notification kind without ever being moved.
- **Impact**: sets a confusing precedent — anyone adding a global notification type has to reach into a feature folder. The label keys it uses (`t.gitlab.notifications`, `t.gitlab.mark_all_read`, `t.gitlab.no_notifications_yet`) live in the GitLab translation namespace despite labelling cross-cutting UI.
- **Fix sketch**:
  - Move to `features/shared/components/notifications/NotificationCenter.tsx`.
  - Move pipeline-only helpers (`statusBg`, `statusEmoji`) into `features/shared/components/notifications/` and re-export the gitlab-specific subset from `features/gitlab/`.
  - Migrate the translation keys from `t.gitlab.*` to `t.notifications.*`.

## 7. GitLab UI lives at `features/gitlab/` while every sibling integration is under `features/plugins/`

- **Severity**: medium
- **Category**: structure
- **File**: src/features/gitlab/ (vs src/features/plugins/{artist,drive,obsidian-brain,research-lab,twin,companion}/)
- **Scenario**: every other integration UI in this scope lives under `features/plugins/<name>/` with a `sub_*` sub-folder convention (e.g. `plugins/research-lab/sub_dashboard/`, `plugins/artist/sub_blender/`). GitLab uses a flat `features/gitlab/components/` + `data/` + `hooks/`. Even the `features/deployment/` directory looks more similar to the plugin convention than gitlab does.
- **Root cause**: GitLab pre-dates the "plugins" reorganisation; the migration left it behind.
- **Impact**: discovering where to add a new integration is harder (two valid precedents, different conventions). The flat layout also makes the GitLab folder less tab-isolatable than its siblings — the existing `GitLabPanel.tsx` is already a 6-tab god-component (connection / deploy / agents / history / gitops / pipelines) where its plugin siblings split each tab into its own `sub_*` folder.
- **Fix sketch**:
  - Plan a one-shot rename: `features/gitlab/` → `features/plugins/gitlab/` with `sub_connection`, `sub_deploy`, `sub_agents`, `sub_history`, `sub_gitops`, `sub_pipelines` folders mirroring sibling plugins.
  - Treat `NotificationCenter` (finding 6) as a separate move, not part of this rename.
  - Update the ~15 import paths in one PR; mostly mechanical.

## 8. Two near-identical `scanFolder → importAsset` loops in artist hooks

- **Severity**: low
- **Category**: duplication
- **File**: src/features/plugins/artist/hooks/useArtistAssets.ts:33-56 vs src/features/plugins/artist/hooks/useCreativeSession.ts:82-100
- **Scenario**: both hooks contain a "scan folder → for each scanned asset call `artistImportAsset` → count nulls vs imports → emit toast / append output line" loop. The bodies have already drifted: `useArtistAssets.scanAndImport` calls `artistEnsureFolders` first and uses `useToastStore`; `useCreativeSession.scanForNewAssets` skips the ensure step and pipes the message through `appendOutput` instead.
- **Root cause**: the auto-scan-after-creative-session was added later and the import loop was copy-pasted instead of factored.
- **Impact**: future changes to the import contract (e.g. adding an `if (asset.size === 0) skip` guard) need to land in two places. The drift in the `artistEnsureFolders` step also means a creative session that writes files to a fresh subdirectory might fail to import them on the auto-scan path.
- **Fix sketch**:
  - Extract a `scanAndImportAssets(folder, { ensureFolders }) → { scanned, imported }` helper into `useArtistAssets` (or `lib/artist`).
  - Both callers reduce to one helper call + their own toast/output formatting.

## 9. `statusEmoji` returns plain text; misleading name

- **Severity**: low
- **Category**: naming
- **File**: src/features/gitlab/hooks/usePipelineNotifications.ts:57-64
- **Scenario**: function is named `statusEmoji(status)` but every branch returns a plain string ("Pipeline Succeeded", "Pipeline Failed", etc.) — no emoji.
- **Root cause**: an earlier version likely prefixed each return with an emoji (✅/❌/⚠️) and the strings were later sanitised for the Tauri notification API, but the name was not updated.
- **Impact**: future readers grep for `Emoji` looking for the icon mapping; reviewers may add emojis back assuming intent. Trivial but it's a 30-second fix.
- **Fix sketch**:
  - Rename to `statusTitle` (it returns the desktop notification title).
  - Update the single caller on line 133.

> Total: 9 findings (2 high, 5 medium, 2 low)
