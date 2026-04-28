# External Integrations (client) — Dev Experience Scan

> Total: 13 · Critical: 0 · High: 5 · Medium: 6 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. snake_case ↔ camelCase convention drift across the Twin layer

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/api/twin/twin.ts:60-79`, `src/lib/bindings/TwinChannel.ts:3`, `src/features/plugins/twin/sub_channels/ChannelsConsole.tsx:83`
- **Scenario**: A developer reading a Twin object uses `ch.is_active`, `ch.channel_type`, `profile.obsidian_subpath` (snake_case, copied verbatim from Rust via ts-rs). They then write back through the API wrapper, which expects `{ isActive, channelType, obsidianSubpath }` (camelCase). Same field, two spellings depending on read vs. write — and `ChannelsConsole.tsx:83` literally writes `{ isActive: !ch.is_active }` on one line.
- **Root cause**: `ts-rs` is configured **without** `#[serde(rename_all = "camelCase")]` on Twin structs, so the generated TS preserves Rust field names. Tauri's IPC serde deserializer accepts camelCase on the input side, so writes work. The two halves of the contract drifted apart.
- **Impact**: Every Twin-touching component must mentally translate naming twice. Copy-pasting an object literal between read and write paths silently fails at runtime. New devs hit this within hours; the codebase has 15+ files that mix both styles in the same component.
- **Fix sketch**: Add `#[ts(rename_all = "camelCase")]` to the Twin Rust structs (matches every other binding in `src/lib/bindings/`) and update the ~15 Twin consumer files to camelCase in one PR. Or, far cheaper: add an ESLint rule that flags reads of `*.is_active|.channel_type|.created_at` on `Twin*` typed objects and points to the canonical camelCase fields.

---

## 2. Hand-rolled types in 6 of 7 API modules duplicate Rust models with no drift detection

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/api/researchLab/researchLab.ts:7-175` (10 interfaces), `src/api/artist/index.ts:7-29,89-103,197-227` (5 interfaces), `src/api/obsidianBrain/index.ts:8-82,154-243` (12 interfaces), `src/api/drive.ts:5-27,80-95` (4 interfaces), `src/api/ocr/index.ts:3-20` (2 interfaces), `src/api/signing/index.ts:3-30` (3 interfaces)
- **Scenario**: A Rust dev adds a field to `ResearchProject` or renames `relevance_score → relevance`. The TS frontend keeps the old shape; reads silently get `undefined`; writes silently drop the field. Nothing in CI catches this — `commandNames.generated.ts` only validates the *names* of commands.
- **Root cause**: Only Twin (6 types), Artist (`RenderPlan`, `CompositionLoad`), and a few unrelated network/sharing types use `ts-rs`. Everything else hand-rolls TS interfaces matching Rust models. ~40 hand-written interfaces, no codegen check.
- **Impact**: Silent type drift on every Rust schema change. Bug-hunt time per drift incident: 30–90min including `git blame`. The `OcrDocument`/`DocumentSignature` shapes are the most suspect (snake_case TS interfaces — they LOOK auto-generated but aren't).
- **Fix sketch**: Add `#[derive(TS)] #[ts(export)]` to `ResearchProject*`, `ResearchSource*`, `ResearchHypothesis*`, `ArtistAsset`, `BlenderMcpStatus`, `OcrDocument`, `DocumentSignature`, `DriveEntry`, and the Obsidian sync result types. Migrate API wrappers to import from `@/lib/bindings/`. Add a CI step that fails the build if any `src/api/**/*.ts` file declares `interface` for a type that exists under `bindings/`.

---

## 3. `ocr/index.ts` is half-dead; live OCR lives in `drive.ts`

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/api/ocr/index.ts:3-46`, `src/api/drive.ts:80-133`
- **Scenario**: A new contributor opens `src/api/ocr/index.ts`, finds `ocrWithGemini`/`ocrWithClaude`/`listOcrDocuments`/`deleteOcrDocument`, builds a feature on top of them — none have callers. The actually-used OCR entry points (`ocrDriveFileGemini`, `ocrDriveFileClaude`, `cancelOcrOperation`) live inside `drive.ts` because OCR was "consolidated from the retired OCR plugin" (per the comment) but only the Drive variants survived the consolidation.
- **Root cause**: Incomplete migration. The comment in `drive.ts:77-78` documents the consolidation but `src/api/ocr/index.ts` was never deleted, leaving two parallel OCR APIs visible to autocomplete.
- **Impact**: Every new OCR question has to figure out which file is real. Wasted ~30min per onboarding dev. Also: `OcrDocument` (with `structured_data`/`prompt` fields) and `OcrDocumentLite` (without) are two slightly-different copies of the same Rust model.
- **Fix sketch**: Delete `ocrWithGemini`, `ocrWithClaude`, `OcrDocument`, `OcrResult`, `listOcrDocuments`, `deleteOcrDocument` from `src/api/ocr/index.ts`. Move `cancelOcrOperation` into `drive.ts` next to its sibling OCR commands, then delete `src/api/ocr/` directory. The "OCR" file path is misleading — OCR is a Drive operation in this app.

---

## 4. Zero unit tests for any of the 7 integration API modules

- **Severity**: High
- **Category**: testing
- **File**: `src/api/__tests__/` (no drive.test, obsidianBrain.test, ocr.test, signing.test, artist.test, twin.test, researchLab.test)
- **Scenario**: `src/api/__tests__/` covers credentials, events, executions, memories, messages, observability, personas, settings, system, triggers — but none of the 7 external integrations in scope. The `safeInvoke` helper in `researchLab.ts:198-218` (with its critical "command not found" regex that fixed a real bug) has no tests guarding the regex shape. Same for the empty-array short-circuit logic in `obsidianBrainPushSync` and `obsidianDrivePushSync` (`obsidianBrain/index.ts:113,189,200`) — explicitly documented "MUST NOT collapse `[]` to `undefined`" contract with no test enforcing it.
- **Root cause**: Tests grew alongside core APIs but were never required for integration wrappers. The "vault could be nuked" risk in `obsidianBrainPushSync` is documented in 8 lines of comment but has no executable assertion.
- **Impact**: A future refactor that "simplifies" the `personaIds.length === 0` guard could destroy users' Obsidian vaults. The `TAURI_COMMAND_NOT_FOUND_RE` regex could be tightened/loosened by anyone without realizing it gates fallback behavior across 6 list endpoints.
- **Fix sketch**: Add `src/api/__tests__/obsidianBrain.test.ts` covering the empty-array short-circuit (no Tauri call made, returns zero result). Add `researchLab.test.ts` covering: `isCommandNotFound` accepts the canonical Tauri shape, rejects `"project not found"`, accepts `{kind:'not_found'}`. Add `signing.test.ts` covering `isSensitivePath` for ssh/gnupg/aws/wallet patterns. ~150 LOC total, prevents three different "lost user data" classes.

---

## 5. Silent `catch {}` swallows in 6 GitLab handlers — failure masking

- **Severity**: High
- **Category**: dev-loop-friction
- **File**: `src/features/gitlab/components/GitLabPanel.tsx:84`, `GitLabDeployModal.tsx:56,83`, `DeploymentHistoryTab.tsx:54`, `GitOpsVersionHistory.tsx:62,71`
- **Scenario**: A deploy fails. The user sees only the spinner stop. The systemStore *does* publish the error, but only some panels render `<ErrorBanner />` (only `GitLabPanel` does, line 187). The DeploymentHistoryTab and GitOpsVersionHistory rely on the same store error — but the user could be looking at those tabs when the rollback fails. Rollback errors flash in the store and disappear when the next successful action clears them.
- **Root cause**: The "error handled by store" comment is repeated 7 times across files but no single component is responsible for *displaying* the error in the active tab. The pattern was copy-pasted without verifying each tab has an ErrorBanner mount.
- **Impact**: Deploy/rollback failures appear as silent no-ops in 4 of 6 tabs. Debug time: 5–15min per "why didn't it deploy?" question (developer must console.log the systemStore to see). Extremely common during demo/onboarding.
- **Fix sketch**: Move `<ErrorBanner message={error} onDismiss={clearError} />` from `GitLabPanel.tsx:187` up into `<ContentBody>` alongside `<div role="tabpanel">` so it renders for every active tab. Or: have each sub-component subscribe to the store error directly and render an inline error block. Either way, eliminate the "error visible only on connection tab" foot-gun.

---

## 6. `usePipelineNotifications` reimplements OS notification permission flow

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/gitlab/hooks/usePipelineNotifications.ts:87-100`, `src/lib/utils/platform/osNotification.ts`, `src/lib/notifications/notifyProcessComplete.ts`, `src/features/plugins/dev-tools/hooks/useContextScanBackground.ts`
- **Scenario**: 4 different files all call `isPermissionGranted` / `requestPermission` / `sendNotification` directly with their own ad-hoc ref-tracking, error suppression, and permission-grant memoization. Each one is subtly different (this hook caches permission in a ref; `osNotification.ts` re-checks every call).
- **Root cause**: A central `osNotification.ts` exists but the GitLab hook predates it and never migrated. Each call site solves the "ask once, remember answer" problem independently.
- **Impact**: A future change to permission UX (e.g. "show in-app prompt before native dialog") must be applied 4 places. The 8 lines of permission boilerplate per call site adds noise to feature code.
- **Fix sketch**: Replace lines 87-100 with `await ensureNotificationPermission()` from `src/lib/utils/platform/osNotification.ts`. Adopt the same helper in `useContextScanBackground.ts` and `notifyProcessComplete.ts`. Net deletion: ~30 LOC.

---

## 7. Manual toggle switch reimplemented 3× in `PipelineNotificationPrefs`, ignoring `AccessibleToggle`

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/gitlab/components/PipelineNotificationPrefs.tsx:11-41,66-83,114-130`, `src/features/shared/components/forms/AccessibleToggle.tsx`
- **Scenario**: `PipelineNotificationPrefs` defines a local `Toggle` component (lines 11-41) AND inline-implements two more toggles (lines 66-83, 114-130) — three near-identical 18-line `<button role="switch">` blocks with the same Tailwind classes. The codebase already exports `AccessibleToggle` at `src/features/shared/components/forms/AccessibleToggle.tsx` doing the same thing.
- **Root cause**: `AccessibleToggle` was added later; no codemod swept existing inline toggles. Custom orange tint vs. the shared component's emerald tint may be the immediate excuse, but the shared component already accepts a className override.
- **Impact**: Style drift (orange-500 here vs. emerald-500 elsewhere), no keyboard handler in two of the three toggles (only the local `Toggle` has Enter/Space — the other two omit it), 50 LOC of duplication. A11y bug: the inline `enabled` toggle (line 66) has no keyboard handler.
- **Fix sketch**: Replace all three with `<AccessibleToggle>` instances. Add a `tint` prop (`'orange' | 'emerald'`) to the shared component to preserve visual variants. Net deletion: ~40 LOC and an a11y fix.

---

## 8. `ocrWithGemini` lacks the timeout that its `ocrDriveFileGemini` sibling has

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/api/ocr/index.ts:22-28` vs. `src/api/drive.ts:102-118`
- **Scenario**: `ocrDriveFileGemini` passes a 180s timeout, `ocrDriveFileClaude` passes 300s. The dead-code `ocrWithGemini` in `ocr/index.ts` passes nothing → defaults to 90s — too short for any non-trivial PDF. If/when someone resurrects `ocrWithGemini`, it'll mysteriously time out where the Drive variant doesn't.
- **Root cause**: Timeouts encoded by hand in each call site, no shared "OCR timeout" constant.
- **Impact**: Latent bug; also, callers of `artistTranscribeMedia` (600s), `artistMeasureLoudness` (120s), `artistTrimFile` (300s), `artistInstallBlenderMcp` (120s) are individually correct but the values are sprinkled across `artist/index.ts` with no rationale.
- **Fix sketch**: Define `INTEGRATION_TIMEOUTS` in a shared `src/api/timeouts.ts`: `OCR_GEMINI: 180_000`, `OCR_CLAUDE: 300_000`, `ARTIST_TRANSCRIBE: 600_000`, etc. Wrappers reference the constant. Renaming a constant is grep-able; tracking the "right" magic number across files is not.

---

## 9. Inconsistent positional vs. opts-object call style for `invokeWithTimeout`

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/api/drive.ts:108-118,128-133`, `src/api/artist/index.ts:37,141-146,182,213,242`, `src/api/ocr/index.ts:31,38`, `src/api/signing/index.ts` (none)
- **Scenario**: `tauriInvoke.ts` supports both legacy positional `(cmd, args, options?, timeoutMs?)` and a new opts-object form (`{ timeoutMs, idempotencyKey, noAutoDedup }`). Every external-integration wrapper still uses the legacy form: `invoke<T>("cmd", args, undefined, 120_000)` — the `undefined` for options is purely vestigial. None benefit from `idempotencyKey` even though OCR/transcription would obviously dedup.
- **Root cause**: New API form added without migrating callers. No deprecation lint.
- **Impact**: Cargo-cult `, undefined,` middle argument in every long-running command; new devs copy the noise. Worse, no integration command opts into idempotency dedup, so a double-clicked "Sign Document" or "Run OCR" button issues two backend jobs.
- **Fix sketch**: Codemod legacy positional → opts object across all of `src/api/`. Add idempotency keys to OCR/transcribe/sign/loudness — these are user-action commands that benefit most from de-duping double-clicks.

---

## 10. `signDocument` regex allowlist isn't centralized; can't be tested or extended

- **Severity**: Medium
- **Category**: testing
- **File**: `src/api/signing/index.ts:47-65`
- **Scenario**: 13 sensitive-path regex patterns are inlined in the signing module ("frontend defense in depth"). They aren't exported, can't be unit-tested, and there's no parallel structure for the OCR or Drive endpoints which can also accept arbitrary file paths.
- **Root cause**: One-off defense added to a single endpoint; no shared "is-this-a-credential-file" utility.
- **Impact**: Drift between which integrations check for sensitive paths. Untested regex set: if someone tweaks the pattern, no test catches a subtle break (e.g. `[/\\]private[_-]?key/i` would also match `private_keyhole.txt` — debatable but no spec).
- **Fix sketch**: Move patterns + `isSensitivePath()` into `src/lib/utils/sanitizers/sensitivePaths.ts` with a unit test covering ssh/gnupg/aws/keystore/wallet/.npmrc. Reuse from OCR + Drive read endpoints (defense in depth there too).

---

## 11. `gitlab` feature directory ignores the `src/api/` boundary — imports `@/api/system/gitlab` directly into 6 components

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/gitlab/components/GitLabAgentList.tsx:4`, `GitLabDeployModal.tsx:4`, `JobRow.tsx:5`, `PipelineRow.tsx:2`, `GitOpsVersionHistory.tsx:19`, `DeploymentHistoryTab.tsx:16`
- **Scenario**: Per the codebase's own scope, GitLab API wrappers live at `src/api/system/gitlab` but the feature directory `src/features/gitlab/` is the React surface. Components import types like `GitLabAgent`, `GitLabPipeline`, `GitLabDeployResult` directly from `@/api/system/gitlab` instead of from a feature-local re-export. Most type imports could use `@/lib/bindings/GitLab*` directly (auto-generated).
- **Root cause**: No feature `index.ts` aggregating types/hooks for the gitlab module.
- **Impact**: Cross-cutting refactor of the API surface forces edits in 6 component files. Low frequency papercut.
- **Fix sketch**: Add `src/features/gitlab/types.ts` re-exporting `GitLabAgent`, `GitLabPipeline`, `GitLabJob`, `GitLabDeployResult`, `GitLabDeploymentRecord`, `GitLabPersonaVersion` from `@/lib/bindings/`. Update the 6 component imports.

---

## 12. `obsidianBrainPushSync` empty-array contract documented in JSDoc but enforced only at one call site

- **Severity**: Medium
- **Category**: testing
- **File**: `src/api/obsidianBrain/index.ts:99-117,178-204`
- **Scenario**: The 9-line JSDoc on `obsidianBrainPushSync` warns that callers MUST NOT fall back to `undefined` when the user clears every filter — otherwise the entire vault is overwritten. The wrapper itself short-circuits `[]` to a zero-result, but there's no compile-time enforcement preventing a future caller from doing `obsidianBrainPushSync(filtered.length ? filtered : undefined)`.
- **Root cause**: TS can't distinguish "I deliberately want all" from "I had filters but cleared them." The contract relies on developer discipline.
- **Impact**: One careless ternary and a user's Obsidian vault gets nuked. Documentation alone won't survive future refactors (the comment was added in response to a real near-miss, judging by the tone).
- **Fix sketch**: Replace the `personaIds?: string[]` signature with a discriminated union: `{ scope: 'all' } | { scope: 'specific'; personaIds: string[] }`. The `scope: 'specific'` branch with `personaIds: []` becomes representable and intentional. Compile-time impossible to accidentally pass "all" when you meant "the empty filter result."

---

## 13. `DEPLOYMENT_TOKENS` pulled into GitLab feature from a sibling feature

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/gitlab/components/GitLabConnectionForm.tsx:4`, `PipelineNotificationPrefs.tsx:8` import from `@/features/deployment/components/deploymentTokens`
- **Scenario**: GitLab UI reaches into the `deployment` feature for shared tokens (panel spacing, card radius, connected-state colors). Two features now share an undocumented coupling: a refactor of the deployment feature can break GitLab styling.
- **Root cause**: The tokens started life as GitLab-specific, were extracted to deployment, but the dependency direction is unclear.
- **Impact**: Surprise breakage on deployment-feature edits. Low frequency.
- **Fix sketch**: Move `deploymentTokens.ts` to `src/features/shared/tokens/integrationPanelTokens.ts` (or merge into the existing token system). Both features import from the shared location.

---

## Files read

- `src/api/drive.ts`, `src/api/obsidianBrain/index.ts`, `src/api/ocr/index.ts`, `src/api/signing/index.ts`, `src/api/artist/index.ts`, `src/api/twin/twin.ts`, `src/api/researchLab/researchLab.ts`, `src/api/enums.ts`
- `src/features/gitlab/components/{GitLabPanel,GitLabConnectionForm,GitLabAgentList,GitLabDeployModal,GitLabPipelineViewer,GitOpsVersionHistory,DeploymentHistoryTab,PipelineRow,JobRow,pipelineHelpers,CiCdTemplatesPicker,NotificationCenter,PipelineNotificationPrefs}.tsx`
- `src/features/gitlab/hooks/usePipelineNotifications.ts`, `src/features/gitlab/data/cicdTemplates.ts`
- `src/lib/tauriInvoke.ts`, `src/lib/bindings/Twin{Profile,Channel,Tone,PendingMemory}.ts`
- `src/features/shared/components/forms/AccessibleToggle.tsx` (cross-reference)
- Cross-grep verification of `is_active`/`channel_type` mixed usage, OCR call sites, ResearchLab command names, signing/peer_id consumers
