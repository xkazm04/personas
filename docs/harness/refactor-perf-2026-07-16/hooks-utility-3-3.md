# hooks/utility [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 3 medium / 0 low)
> Context group: Core Libraries & State | Files read: 9 | Missing: 0

## 1. useSaveFeedback + useSettingsSaveToast are dead code (no consumers repo-wide)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/utility/interaction/useSaveFeedback.ts:8 (and src/hooks/utility/interaction/useSettingsSaveToast.ts:13)
- **Scenario**: A repo-wide grep for `useSaveFeedback|useSettingsSaveToast` matches only the two hook files themselves (plus context-map.json / lint-output.json metadata). Neither is re-exported from `src/hooks/index.ts`, and no component or feature imports either.
- **Root cause**: The "settings panels save confirmation" pattern these were built for was either never adopted or was replaced by direct toastStore usage; the hooks were left behind.
- **Impact**: Two orphaned files (~48 LOC) that read as an active convention ("Shared save-feedback hook for settings panels") and will mislead future settings-panel work; useSettingsSaveToast also carries a live dependency on `@/stores/toastStore`.
- **Fix sketch**: Delete both files (useSettingsSaveToast is the only consumer of useSaveFeedback, so they go together). Hooks cannot be invoked dynamically by string, so grep evidence is conclusive; only cross-check that no test files outside src/ reference them (repo-wide grep already found none).

## 2. Duplicate useToggleSet implementation in hooks/lab is unused
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/lab/useToggleSet.ts:12
- **Scenario**: Two hooks named `useToggleSet` exist: the tuple-style one in this context (`hooks/utility/interaction/useToggleSet.ts`, exported via `hooks/index.ts` and used by `designStateHelpers.ts`) and a richer object-API variant in `hooks/lab/useToggleSet.ts`. Grep shows zero imports of the lab variant anywhere in the repo.
- **Root cause**: The lab version (with `has/clear/addAll/set`) was written independently or as an experiment and never wired to any caller, while the interaction version became the canonical one.
- **Impact**: Same-named hooks with different signatures invite the wrong import (autocomplete offers both) and double the maintenance surface for identical toggle logic.
- **Fix sketch**: Delete `src/hooks/lab/useToggleSet.ts`. If the richer API is ever needed, extend the canonical interaction version rather than resurrecting the lab copy.

## 3. useMobilePreview reads phantom `__VITE_PLATFORM_*__` globals — BUILD_MOBILE is always false
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/hooks/utility/interaction/useMobilePreview.ts:8-11
- **Scenario**: The hook computes a local `BUILD_MOBILE` from `globalThis.__VITE_PLATFORM_ANDROID__ || globalThis.__VITE_PLATFORM_IOS__`, but a repo-wide grep shows those identifiers are defined nowhere (no `define` in vite config, no build script sets them). The expression is always `false || false || false`.
- **Root cause**: Leftover from an earlier build setup; the real platform flag lives in `lib/utils/platform/platform.ts` as `BUILD_MOBILE` derived from `import.meta.env.VITE_PLATFORM`, which this file already partially imports (`IS_MOBILE as BUILD_IS_MOBILE`).
- **Impact**: Dead logic that reads as if dev builds honor the compile-time platform. On a dev build running on an actual Android/iOS device (`VITE_PLATFORM` set + `DEV` true), `getSnapshot()` ignores the real platform and returns only the Ctrl+Shift+M preview state — silently wrong, and it duplicates platform-detection logic the platform module owns.
- **Fix sketch**: Drop the local `BUILD_MOBILE` constant. Since `IS_MOBILE` in platform.ts already equals `BUILD_MOBILE || _devMobileOverride` and is kept current by the same `onMobilePreviewChange` listener, `getSnapshot` can simply return the imported `BUILD_IS_MOBILE` binding in both modes (or, to keep the explicit dev composition, use platform.ts's exported flags instead of phantom globals).
