# lib (misc 3) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. Six dead exports across modelCatalog, templateIconResolver, and templateVerification
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/models/modelCatalog.ts:23 (also src/lib/icons/templateIconResolver.ts:19,37; src/lib/templates/templateVerification.ts:26,62)
- **Scenario**: Repo-wide grep (src/, src-tauri/, scripts/) finds zero call sites for: `MODEL_I18N_KEYS` and `getAllModels` (modelCatalog.ts:23,41), `resolveTemplateAgentIcon` and `resolveIconForCategories` (templateIconResolver.ts:19,37), async `computeContentHash` (templateVerification.ts:26 — only the sync variant is used, by templateCatalog.ts and a Rust port), and singular `registerBuiltinTemplate` (templateVerification.ts:62 — only the plural `registerBuiltinTemplates` is called). Only doc-file mentions remain.
- **Root cause**: Convenience/superseded variants were left exported after callers migrated (e.g. `resolveIconForTemplate` superseded `resolveIconForCategories`; `computeContentHashSync` superseded the Web Crypto version).
- **Impact**: Dead API surface misleads readers about what the module contract is (`resolveTemplateAgentIcon` even pulls the whole template catalog for a lookup nobody performs) and keeps the unused async-hash path alive next to the sync one that is security-relevant.
- **Fix sketch**: Delete the six exports (and the now-unused `getTemplateCatalog` import in templateIconResolver.ts). One verification pass needed for dynamic access: none of these names appear in string form anywhere, so a straight delete + `tsc` is sufficient. Update the two docs pages that reference `registerBuiltinTemplates` flow only if they name the removed singular form.

## 2. `isTypingTarget` implemented four times, one of them already exported
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/keyboard/ShortcutCheatSheet.tsx:15
- **Scenario**: `KeyboardNavMode.tsx:29` exports the canonical `isTypingTarget` (used by NavHistoryShortcuts, DevInspector, TitleBarDock), yet `ShortcutCheatSheet.tsx:15`, `WorkspaceShortcuts.tsx:21`, and `features/plugins/companion/orb/AthenaOrbLayer.tsx:18` each keep a private byte-identical copy.
- **Root cause**: The helper was born inline in each shortcut component; when it was later exported from KeyboardNavMode, the sibling copies were never rewired.
- **Impact**: Any refinement (e.g. honoring `role="textbox"`, `<select>`, or closed shadow roots) must be applied in four places or shortcut components silently disagree on when to hijack keys — exactly the drift class this keyboard layer was built to prevent.
- **Fix sketch**: Move `isTypingTarget` into `shortcutRegistry.ts` (or a new `keyboard/domTargets.ts`) since KeyboardNavMode is an odd home for a shared predicate; re-export from KeyboardNavMode for the three existing importers or update them; delete the three private copies.

## 3. OS-notification permission dance duplicated in three modules
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/notifications/notifyFleetAwaiting.ts:19
- **Scenario**: The `isPermissionGranted()` → `requestPermission()` → `sendNotification()` sequence is written out verbatim in `notifyFleetAwaiting.ts:19-25`, `notifyProcessComplete.ts:55-62`, and `features/plugins/dev-tools/hooks/useContextScanBackground.ts:32+` (plus a variant in gitlab `usePipelineNotifications.ts`).
- **Root cause**: Each notification surface re-implemented the Tauri plugin boilerplate instead of sharing one best-effort sender.
- **Impact**: Behavior drift risk: each copy independently decides whether to re-prompt for permission and how to swallow errors; a future policy change (e.g. "never re-prompt, cache denial") needs 3-4 coordinated edits.
- **Fix sketch**: Add `sendOsNotification(title, body): Promise<void>` in `src/lib/notifications/` that encapsulates the permission check + lazy request + `sendNotification` + `silentCatch`; have `notifyFleetAwaiting` become a one-line wrapper (or be deleted in favor of the shared helper) and rewire `notifyProcessComplete` and the two hooks.

## 4. `notifyProcessComplete` blocks the in-app notification behind a potentially long OS permission prompt
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: blocking-await
- **File**: src/lib/notifications/notifyProcessComplete.ts:55
- **Scenario**: When OS notification permission has not been granted, `await requestPermission()` at line 57 suspends until the user answers the OS prompt (or the webview resolves it). The in-app `addProcessNotification` call at line 66 only runs after that await chain, so the notification-center entry — the primary, always-available surface — is delayed for the whole prompt duration on every process completion until permission is resolved.
- **Root cause**: The best-effort OS-notification block and the guaranteed in-app store write are sequenced instead of independent; the OS branch was written first and the store write appended after it.
- **Impact**: Perceived latency: process-complete toasts/badges appear late (or effectively never, if the user ignores the prompt) even though the data is local and synchronous. Also, callers that `await notifyProcessComplete(...)` inherit the stall.
- **Fix sketch**: Write to the notification center first (it is synchronous), then fire the OS notification without awaiting from the caller's perspective: `void (async () => { ...permission + sendNotification... })()`. This also pairs naturally with the shared `sendOsNotification` helper from finding 3.
