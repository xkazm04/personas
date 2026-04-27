# Agent Editor & Configuration — Dev Experience Scan

> Total: 12 · Critical: 1 · High: 5 · Medium: 4 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Zombie duplicate of `PersonaSettingsTab.tsx` masquerading as the live tab

- **Severity**: Critical
- **Category**: convention-drift
- **File**: `src/features/agents/sub_settings/PersonaSettingsTab.tsx` (dead) vs `src/features/agents/sub_settings/components/PersonaSettingsTab.tsx` (live)
- **Scenario**: A developer told to "edit the persona settings tab" opens the file path the audit prompt itself listed (`sub_settings/PersonaSettingsTab.tsx`), changes a label, runs the app and sees nothing change. The barrel `sub_settings/index.ts` exports `./components/PersonaSettingsTab`, so the top-level file is unreachable but still readable, indexable by IDE jump-to-definition, and matched by Grep — making it a permanent decoy. Worse: the dead file still includes `<TwinBindingCard />`, a `t.agents.settings_status.irreversible` warning row, and the "Active" toggle, none of which are in the active tab. Anyone porting a feature from one to the other will diverge them further.
- **Root cause**: The component was moved to `components/` but the original file was never deleted; no codeowners check, no CI rule blocks orphaned source files.
- **Impact**: Hours per developer on the first wrong edit; permanent risk of feature regression because the two implementations have diverged in ways not captured by any test.
- **Fix sketch**: (1) `git rm sub_settings/PersonaSettingsTab.tsx` and `sub_settings/TwinBindingCard.tsx` if also dead, then add the missing `<TwinBindingCard />` and any other missing rows to the live `components/PersonaSettingsTab.tsx`. (2) Add a knip / `ts-prune` config to CI that flags unreachable top-level source. (3) Add an ESLint rule banning `.tsx` files at module roots when a same-named file exists under `components/`.

## 2. Same drift in `sub_model_config` — duplicate `credentials/` directory

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_model_config/credentials/{ProviderCredentialField,SaveConfigButton,OllamaApiKeyField,LiteLLMConfigField}.tsx` (dead) vs `src/features/agents/sub_model_config/components/` (live, exported from `index.ts`)
- **Scenario**: Four files exist at both `credentials/` and `components/` paths, both compile, neither has a test. `index.ts` exports the `components/` versions; `credentials/` is shadow code. Any developer using global Grep sees two hits per symbol and has to reason about which is canonical every time.
- **Root cause**: Move-without-delete, identical to #1. AGENTS.md establishes a `sub_<noun>/` ownership convention but does not specify a layout rule (`components/` vs flat) — both styles coexist within the same `sub_` modules.
- **Impact**: Doubled cognitive load on every search; risk of editing the wrong file; bundle size bloat (Vite tree-shakes unreachable but ESLint cannot warn on broken imports here because both paths typecheck).
- **Fix sketch**: Remove `sub_model_config/credentials/` entirely. Document the layout rule in `AGENTS.md`: "components in `components/`, libs in `libs/`, hooks in `hooks/`, no source files at module root except `index.ts` and the named entry component." Add knip to enforce.

## 3. Zero tests on the entire editor / save / undo surface

- **Severity**: High
- **Category**: testing
- **File**: `src/features/agents/sub_editor/**/*`, `sub_design/**/*`, `sub_settings/**/*`, `sub_model_config/**/*`
- **Scenario**: Searched for `*.test.*` under all four sub-modules: zero hits. The only persona-adjacent tests are `sub_use_cases/components/matrix/__tests__/*` and `stores/__tests__/personaStore.test.ts`. Yet `EditorDocument.tsx` implements a non-trivial dirty/save/undo state machine (350 lines, race-condition guards), `useDebouncedSaveGroup.ts` has subtle in-flight-snapshot logic explicitly written to fix data-loss bugs, and `useEditorSave.ts` carries an `undo entry tagged with personaId` mechanism that comments confess existed because the bug "silently corrupts B and lies that 'All saved'". None of these invariants are tested.
- **Root cause**: Cultural — the matrix subteam writes tests, the editor subteam does not. Vitest and `@testing-library/react` are already in the project (used by matrix tests).
- **Impact**: Every bug-fix PR in this surface has had to add a comment explaining why the fix is needed and what could regress. Re-introducing a regression is a Ctrl+Z away in `useEditorSave` and there is no automated alarm.
- **Fix sketch**: Start with three pure-logic tests (no React) that capture the most expensive past bugs as regression tests: (a) `useDebouncedSaveGroup` does not drop keystrokes that arrive during the await window; (b) Ctrl+Z after persona switch does not restore values into the wrong persona; (c) `saveAll` partial failure marks succeeded tabs clean and surfaces the failed list. These three tests would have caught the three bugs whose comments dominate the file headers.

## 4. Massive prop-drilling pipe at `DesignTab` → `DesignTabPhaseContent` → `renderPhaseContent`

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/agents/sub_design/DesignTab.tsx:7-82`, `components/DesignTabPhaseContent.tsx`, `components/PhaseContentRenderers.tsx:16-60`
- **Scenario**: `useDesignTabState()` returns a 32-key object. `DesignTab` destructures it, then forwards 32 props to `DesignTabPhaseContent`, which forwards them to `renderPhaseContent`, which spreads them into 7 phase components. The `PhaseRenderProps` interface is 45 fields long. Adding any new design-flow field means editing 4 type signatures and 4 call sites, none of which the compiler can group together.
- **Root cause**: The "lift state to a single hook, drill down" pattern was adopted before context was considered. Every phase needs only a slice (e.g. `DesignPhaseAnalyzing` needs 4 fields), but they all see all 45.
- **Impact**: Each edit is high-friction; merge conflicts on the prop list are routine; `git blame` on `PhaseContentRenderers.tsx` is a chain of "added prop X" commits. New developers cannot tell from `DesignTab.tsx` what state is actually consumed where without tracing through the spread.
- **Fix sketch**: Wrap `useDesignTabState` in a `DesignTabContext` provider; have each phase component pull its own slice via `useDesignTabContext()`. Phase components then declare their own dependencies, the prop interface vanishes, and adding a new field touches only the producer hook and the consuming phase. Alternative: split the state object into 3-4 themed sub-objects (`flow`, `selection`, `conversation`, `context`) and pass those as opaque blocks.

## 5. Dead documented file paths in audit context (and likely in onboarding docs)

- **Severity**: High
- **Category**: documentation
- **File**: Audit context referenced `sub_prompt/components/PersonaPromptEditor.tsx`, `PromptSectionSidebar.tsx`, `CustomSectionsPanel.tsx`. None exist in `src/`; they exist only inside `.claude/worktrees/*` (19 worktree copies). Confirmed by `editorTabConstants.ts:19` comment: "Design hub absorbs Prompt and Connectors save groups (former standalone tabs)".
- **Scenario**: The Prompt tab was retired and consolidated into `DesignHub`. Anyone reading recent onboarding docs, PRs, or this very audit's context list still sees `PersonaPromptEditor` as a primary file. New devs go looking, find nothing, ask in chat, lose 15-30 minutes per occurrence. AGENTS.md does not list the deletion. `editorTabConstants.ts` mentions "prompt" and "connectors" as save-group dependencies but those are no longer visible tabs.
- **Root cause**: Migration documentation was not updated. The dirty-deps `'prompt'` entry persists for backward-compat without a comment explaining when (if ever) it can be removed.
- **Impact**: Friction every time a doc, audit, ticket, or LLM prompt references the old path; ongoing noise in code search hits inside `.claude/worktrees/`.
- **Fix sketch**: (1) Add a `MIGRATIONS.md` section to AGENTS.md documenting "Prompt tab → DesignHub (date)", with the dirty-key list. (2) Add a comment to `editorTabConstants.ts:18-19` explaining the legacy `'prompt'` save group and its sunset condition. (3) Configure ripgrep / Grep tooling to exclude `.claude/worktrees/` by default (project `.rgignore`).

## 6. `useEditorDirty` writes registries during render — fragile, easy to misread

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/features/agents/sub_editor/libs/EditorDocument.tsx:284-303`
- **Scenario**: `useEditorDirty` calls `store.registerSave(tab, save)` and `store.registerCancel(tab, cancel)` inside the render body, with a comment claiming this is safe because they don't notify. But every render replaces the registered closures, including new closures every time a parent re-renders — meaning `saveAll` always picks up the *latest* render's closure, not the one that captured the consumer's intended `draft` snapshot. This works only because `useDebouncedSaveGroup` reads from refs. If a future tab consumer forgets the ref pattern and registers a closure that captures props directly, `saveAll` will silently use whichever happened to be registered last. The render-side mutation also breaks React 18 strict-mode double-invoke when registering callbacks that race a notify call elsewhere.
- **Root cause**: Optimisation to avoid double-effects, with the trade-off undocumented at the call site.
- **Impact**: Easy to introduce a subtle save bug by following the obvious "just register a closure" pattern in a new tab. Strict mode surprises in the future.
- **Fix sketch**: Move `registerSave`/`registerCancel` into a `useEffect` keyed by `[store, tab, save, cancel]`. Pay the small effect-rerun cost; remove a footgun. Add JSDoc with example usage.

## 7. Cross-tab dirty dependencies are silently stale documentation

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/agents/sub_editor/libs/editorTabConstants.ts:15-33`
- **Scenario**: `TAB_DIRTY_DEPENDENCIES` includes `design: ['prompt', 'connectors']` and `TAB_LABELS` lists `prompt`, `assertions`, `connectors`, `lab`. None of these are tabs the user can see (`tabDefs` in `EditorTabBar.tsx` lists only activity, design, use-cases, lab, chat, settings; assertions/prompt/connectors don't appear). The labels exist purely for failed-save error messages that include former save-group names. There's no test that the keys here are still real, and nothing in CI catches when a tab is removed.
- **Root cause**: Save groups were promoted/demoted but the constants file became frozen.
- **Impact**: Reading the file misleads developers about which tabs exist and which dirty cascades fire. A "prompt" dirty flag can never actually trip because no tab registers it any more — the dependency entry is dead but looks live.
- **Fix sketch**: Add a runtime sanity check (one-shot in dev): on mount, log a warning if any key in `TAB_DIRTY_DEPENDENCIES` or `TAB_LABELS` doesn't appear in the actual `tabDefs` AND isn't a registered save-group name from `useTabSection`. Or: enforce that `TAB_LABELS` keys are a subset of `EditorTab | <save-group-id>` types via an exhaustiveness assertion (the file already has this for `PersonaDraft` keys — extend the pattern).

## 8. `useDesignContextSync` / `useResultSelectionSync` have intentionally-stale exhaustive-deps

- **Severity**: Medium
- **Category**: testing
- **File**: `src/features/agents/sub_design/libs/designStateHelpers.ts:40-43, 81-91`
- **Scenario**: `useEffect` in `useDesignContextSync` lists `[selectedPersona?.id]` but reads `selectedPersona?.design_context` and the setter — the only way this runs correctly is if the consumer never expects `design_context` updates without a persona switch. There's no eslint-disable, no comment, and no test. Same trick in `useResultSelectionSync` (deps `[resultId]`, body reads `result`). This is the kind of effect that works until someone updates `design_context` in place via the mutation queue and wonders why the editor doesn't reflect the change.
- **Root cause**: Dependency was narrowed to fix an over-firing bug without documenting the contract.
- **Impact**: Future bugs that look like "the design pane shows stale context after I edit it elsewhere" with no obvious cause.
- **Fix sketch**: Add `// eslint-disable-next-line react-hooks/exhaustive-deps` with a 1-line comment per skipped dep explaining why; or refactor to use a deep-equality compare with `useMemo` so the dep list is honest.

## 9. `editorTab` redirect lives in `EditorBody` instead of `useSystemStore`

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/sub_editor/components/EditorBody.tsx:107-118`
- **Scenario**: The "starter tier shouldn't see lab/activity/matrix" rule is enforced via a `useEffect` inside the editor body that calls `setEditorTab('use-cases')`. There's also a "matrix tab is legacy → bounce" rule in the same effect. Both belong in the store's `setEditorTab` reducer (validated, idempotent, single source of truth) rather than in a render-time effect of one component. Consequence: anyone navigating directly to `editorTab=lab` via deep-link/persisted state gets a 1-frame flash of the wrong tab while the effect runs.
- **Root cause**: Side-effect logic accreted in the consuming component instead of being moved into the store action.
- **Impact**: Visual flash on cold start; rule duplication if a second consumer (e.g. simple-mode) needs the same enforcement.
- **Fix sketch**: Move the validity check into `setEditorTab(tab)` in `useSystemStore`. The reducer can read tier+isLegacy and refuse/redirect synchronously, removing the effect.

## 10. `INPUT_FIELD` token + ad-hoc card classes copy-pasted across settings forms

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:64, 113, 64`, `TwinBindingCard.tsx:107`, `sub_model_config/components/CustomModelConfigForm.tsx`, ~6 more
- **Scenario**: Every section uses the same `<div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 ...">` wrapper, the same `<h4 className="flex items-center gap-2.5 typo-submodule-header tracking-wide"><span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" /> ...</h4>` pattern, and the same `INPUT_FIELD` token. There's no `<SettingsCard title=…>` shared component, so a designer's restyle requires editing 8+ files in lockstep.
- **Root cause**: The pattern was extracted to `INPUT_FIELD` but the surrounding card chrome was not.
- **Impact**: Visual drift accumulates between sections; designers cannot ship a single-PR theme update.
- **Fix sketch**: Add `<SettingsCard title icon>` and `<SettingsSectionHeading>` to `features/shared/components/layout/`, replace the 8 copies. Codemod-able in 30 minutes.

## 11. `useEditorDraft` returns 18 fields with no internal grouping

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/agents/sub_editor/hooks/useEditorDraft.ts:78-99`
- **Scenario**: The hook's return shape is one flat object with 18 keys: `draft`, `baseline`, `patch`, `setBaseline`, `isSaving`, `modelDirty`, `saveError`, `isDirty`, `allDirtyTabs`, `saveAllTabs`, `cancelAllDebouncedSaves`, `clearAllDirty`, `undo`, `redo`, `partialLoadWarnings`, `dismissWarnings`, `showDeleteConfirm`, `setShowDeleteConfirm`, `connectorsMissing`, `setConnectorsMissing`. `EditorBody.tsx` consumes 16 of them. Adding a 19th means another bullet in the destructure and another entry in the return object, with no compiler-enforced grouping that says "save state lives together, history lives together, warnings live together".
- **Root cause**: Over time, every editor concern gravitated into this one hook because it owns the persona-switch reset effect.
- **Impact**: The hook signature is a top-of-file fixture; minor enhancements look like big diffs; reviewers can't tell what's load-bearing.
- **Fix sketch**: Group the return into `{ document: { draft, baseline, patch, setBaseline }, save: { isSaving, modelDirty, saveError, saveAllTabs, ... }, history: { undo, redo }, warnings: { partialLoadWarnings, dismissWarnings }, ui: { showDeleteConfirm, setShowDeleteConfirm, connectorsMissing, setConnectorsMissing } }`. Or split into 3 hooks consumed in order.

## 12. `ModelABCompare` and `EditorBody` both implement persona-switch race guards by hand

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/agents/sub_model_config/ModelABCompare.tsx:62-67, 86-96`, `src/features/agents/sub_design/libs/useDesignTabState.ts:73-95`, `src/features/agents/sub_editor/libs/useEditorSave.ts:48-73`
- **Scenario**: Three different files implement the same pattern with three different shapes: "snapshot persona id at the start of an async op, abort/cancel if it changed before the op resolves." Each has its own subtle variant (`useRef`, `cancelled` boolean, `personaId`-tagged closure). All three carry comments explaining a real bug that the pattern fixes. Anyone writing a fourth async-persona-bound flow has to re-discover the pattern.
- **Root cause**: No shared `useScopedToPersona(callback, deps)` or `usePersonaToken()` utility.
- **Impact**: Every new async-bound flow re-implements (often imperfectly) what should be a 5-line shared hook. Each implementation drift adds review burden.
- **Fix sketch**: Extract `useCurrentPersonaToken()` returning `{ personaId, isStillCurrent: () => boolean, abortIfChanged: <T>(p: Promise<T>) => Promise<T> }`. Migrate the three sites; document the pattern in AGENTS.md under `sub_editor` ownership.
