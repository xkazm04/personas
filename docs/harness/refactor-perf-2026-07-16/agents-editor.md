# agents/editor — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 2 medium / 3 low)
> Context group: Persona Authoring & Design | Files read: 24 | Missing: 0

## 1. Draft-reset effect keyed on `selectedPersona` object identity — resets draft/baseline and wipes undo history on every store persona update
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: state-churn
- **File**: src/features/agents/sub_editor/hooks/useEditorDraft.ts:81
- **Scenario**: The "reset draft when persona changes" effect deps are `[selectedPersona?.id, pendingPersonaId, clearHistory, selectedPersona]`. Including the whole `selectedPersona` object means the effect fires whenever the store replaces the persona object — which happens after every `applyPersonaOp` autosave round-trip, not only on an actual persona switch.
- **Root cause**: The effect intends id-based reset semantics (the body even maintains `prevPersonaIdRef` for that purpose) but depends on object identity, so any store refresh re-runs `buildDraft`, `setDraft`, `setBaseline`, `setShowDeleteConfirm(false)` and — critically — `clearHistory()`.
- **Impact**: After each debounced autosave (800ms cadence while typing in Settings), the undo stack that `performSettingsSave`/`performModelSave` just pushed is immediately cleared, making Ctrl+Z effectively dead across autosaves; keystrokes typed between the save snapshot and the store refresh are clobbered back to persisted values; and the whole editor tree re-renders from the draft/baseline resets. Verification needed that `applyPersonaOp` replaces the `selectedPersona` reference in agentStore (it almost certainly does for the header/effective-persona merge to work).
- **Fix sketch**: Gate the body on an actual id change using the already-present `prevPersonaIdRef` (`if (selectedPersona.id === prevPersonaIdRef.current) return;`) so store refreshes for the same persona are no-ops, or drop `selectedPersona` from deps and read the latest object via `useAgentStore.getState()` inside the effect. Keep `clearHistory` strictly on id change.

## 2. `preparationFingerprint` runs `JSON.stringify` over prompt/design-context blobs on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: hot-path-compute
- **File**: src/features/agents/sub_editor/hooks/useEditorDraft.ts:48
- **Scenario**: `useEditorDraft` re-renders on every draft keystroke (draft is local state). Each render stringifies `system_prompt`, `structured_prompt`, `design_context`, `model_profile` plus sorted tool/automation id arrays — these prompt/context blobs can be multiple KB.
- **Root cause**: The fingerprint is computed inline in the hook body (no memoization); it only exists to serve as an effect dependency for the 800ms `preparePersonaExecution` warm-up.
- **Impact**: Redundant serialization + two array sorts on the hottest render path in the editor (typing). Bounded but pure waste — the inputs only change when the store persona changes, not per keystroke.
- **Fix sketch**: Wrap in `useMemo(() => JSON.stringify({...}), [selectedPersona])`, or cheaper: depend on the raw fields directly in the effect dep array (`[id, system_prompt, structured_prompt, design_context, model_profile]`) and drop the stringify entirely — the tools/automations arrays can be fingerprinted with a memoized joined-id string.

## 3. EditorBody hand-rolls two red error banners while `BannerPrimitive`'s `red` scheme sits unused
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_editor/components/EditorBody.tsx:151
- **Scenario**: The failed-tabs banner (lines 151-166) and the save-error banner (lines 168-173) both re-implement the banner shell (`animate-fade-slide-in mx-6 my-2 rounded-modal ... bg-red-500/10 border border-red-500/20`) inline, right next to three usages of the shared `BannerPrimitive` from EditorBanners.tsx.
- **Root cause**: `BannerPrimitive` already defines a `red` entry in `COLOR_SCHEMES` (EditorBanners.tsx:32) that nothing consumes; the two inline banners were added without routing through it (likely because `BannerPrimitive` requires `onDismiss`).
- **Impact**: Styling drift risk (the inline shells already differ slightly: `p-3` vs `px-3 py-2`) and the `red` scheme is dead weight until consumed. Any future banner restyle must touch three places.
- **Fix sketch**: Add an optional `onDismiss` (hide the X when absent) to `BannerPrimitive`, export a `SaveErrorBanner`/generic error banner from EditorBanners.tsx using the existing `red` scheme, and replace both inline blocks in EditorBody. If not consolidated, delete the unused `red` scheme.

## 4. `probe_cli_capabilities` invoked on every DeepFanoutToggle mount with no session cache
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: redundant-ipc
- **File**: src/features/agents/sub_editor/components/DeepFanoutToggle.tsx:57
- **Scenario**: Each time the toggle mounts (tab switch back into the hosting surface, persona switch), it re-invokes `probe_cli_capabilities` over Tauri IPC; the probe on the Rust side typically shells out to inspect the CLI, which is far more expensive than the render it gates.
- **Root cause**: The availability result is stored in component state, so it dies with the component; `invokeWithTimeout`'s 250ms read-only dedup only coalesces concurrent mounts, not remounts.
- **Impact**: Repeated process-probe latency and a visible disabled→enabled flicker on every remount, for a value that cannot change mid-session without a settings change.
- **Fix sketch**: Cache the `CliCapabilities` promise at module level (or in systemStore) and reuse it across mounts, with an explicit invalidation hook if CLI settings can change at runtime.

## 5. Dead `prevPersonaIdRef` bookkeeping in useEditorDraft
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_editor/hooks/useEditorDraft.ts:24
- **Scenario**: `prevPersonaIdRef` is assigned in both persona-change effects (lines 72, 88) but never read anywhere in the file.
- **Root cause**: Leftover from an earlier id-comparison guard that was removed (ironically the guard finding #1 needs).
- **Impact**: Misleading write-only state that suggests id-change detection exists when it doesn't; small comprehension tax on a hook that already coordinates a lot.
- **Fix sketch**: Either delete the ref and its two assignments, or (preferred) repurpose it as the id-change guard for the reset effect per finding #1.

## 6. `decisions.slice(0, 0)` dead indirection in PersonaDecisionsFooter
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/agents/sub_editor/components/PersonaDecisionsFooter.tsx:61
- **Scenario**: `const visible = open ? decisions : decisions.slice(0, 0);` — `slice(0, 0)` is always `[]`, and `visible` is only ever rendered inside the `{open && (...)}` block, so the closed branch is unreachable.
- **Root cause**: Leftover from a design that showed a preview subset when collapsed (`slice(0, N)`) that was later reduced to N=0 instead of being removed.
- **Impact**: Pure noise — a reader has to work out that the ternary is a no-op; allocates a throwaway array per render while closed.
- **Fix sketch**: Delete `visible` and map over `decisions` directly inside the `open &&` block.
