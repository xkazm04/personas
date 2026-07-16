# templates/n8n [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 2 high / 3 medium / 0 low)
> Context group: Templates & Recipes | Files read: 34 | Missing: 0

## 1. Orphaned transform/edit/confirm UI subtree (~14 files) after the wizard was cut down to upload+analyze
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_n8n/steps/N8nImportTab.tsx:156
- **Scenario**: `N8nImportTab` (the only mount point, via `DesignReviewsPage`) renders step content ONLY for `upload` and `analyze`; the "Build Persona" button hands off to the PersonaMatrix. Yet the wizard's whole transform/edit/confirm rendering surface still ships: `N8nEditStep.tsx`, `widgets/N8nTransformChat.tsx`, `steps/confirm/N8nConfirmStep.tsx` (component; only its `ConfirmResult` type is imported), `steps/PersonaPreviewCard.tsx`, `widgets/WorkflowThumbnail.tsx` (zero importers anywhere), plus their exclusive dependencies `widgets/StreamingSections.tsx`, `widgets/N8nQuestionStepper.tsx`, `widgets/N8nQuestionListView.tsx`, `widgets/N8nQuestionListbox.tsx`, `widgets/TransformPhaseStepper.tsx`, `edit/N8nEntitiesTab.tsx`, `edit/N8nUseCasesTab.tsx`, `edit/ConnectorRow.tsx`, `edit/useConnectorStatuses.ts`. Grep over src/ + test globs confirms none of these components is rendered by any live code path (the similarly named `sub_connectors/libs/useConnectorStatuses.ts` is a different module). `N8nWizardFooter`'s edit/confirm branches and `N8nStepIndicator`'s Hammer fallback are likewise unreachable.
- **Root cause**: The edit/confirm flow was migrated to the PersonaMatrix build pipeline, but the old wizard-step surfaces were left in place, and `N8nSessionList.handleLoad` still routes restored sessions to `targetStep: 'edit'`/`'transform'` — steps the tab renders as a blank content area with only a footer.
- **Impact**: ~2,500 LOC of unreferenced UI kept in the bundle and maintained (i18n keys, color tokens, a11y passes all still touch it); worse, session restore can land users on a step with no renderer (blank panel), which is a live UX hazard, not just cruft.
- **Fix sketch**: Decide the product direction first: either (a) delete the subtree, keep `n8nConfirmTypes.ts` for the `ConfirmResult` type, prune the edit/confirm branches from `N8nWizardFooter`, and remap `N8nSessionList` step routing so draft/edit sessions route into the matrix hand-off; or (b) re-wire `N8nImportTab` to actually render transform/edit/confirm again. Verify cross-context callers in the templates-n8n [2/2] slice (useResolvedEntities, useN8nDesignData, connectorHealth are shared and stay) before deleting.

## 2. DB-sync effect re-serializes the whole parse result on every dispatch, including per-line stream updates
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: hot-path-serialization
- **File**: src/features/templates/sub_n8n/hooks/useN8nSession.ts:141
- **Scenario**: The auto-sync effect's dependency array ends with the entire `state` object, so it re-runs on EVERY reducer dispatch — including `TRANSFORM_LINES`, which fires for each CLI output batch during a transform, and `ANSWER_UPDATED` on each keystroke. Each run calls `deriveDbSlice(state)`, which `JSON.stringify`s `parsedResult` (the full workflow parse, easily hundreds of KB for a big n8n export), `draft`, `questions`, and `userAnswers` — usually only to conclude via `slicesEqual` that nothing changed.
- **Root cause**: `state` was added to the dep list alongside the nine specific fields it was meant to summarize, making the granular deps meaningless; and the diffing strategy serializes before comparing instead of comparing references first.
- **Impact**: O(workflow-size) stringify work on the UI thread once per streamed line batch and per keystroke while a transform runs — measurable jank on large workflows exactly when the user is watching live output.
- **Fix sketch**: Remove `state` from the dep array (the specific fields already cover every key `deriveDbSlice` reads — add `state.transformSubPhase`-relevant ones explicitly). Inside the effect, short-circuit with reference equality (`prev.parsedResult === state.parsedResult` etc.) before serializing; only stringify the fields whose references changed, or cache the serialized string per object reference.

## 3. Composed reducer always returns a fresh state object, defeating useReducer bail-out
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_n8n/hooks/useN8nImportReducer.ts:212
- **Scenario**: `n8nImportReducer` runs all four sub-reducers and returns `{...nav, ...session, ...transform, ...test}` unconditionally. Even when every sub-reducer returns its slice unchanged (unhandled action types hit `default: return slice`), the final spread creates a brand-new object, so React's `useReducer` identity bail-out never triggers and the entire wizard tree re-renders on every dispatch.
- **Root cause**: The composition layer spreads slices without checking whether any sub-reducer actually produced a change.
- **Impact**: Every action — including ones a given slice ignores — re-renders `N8nImportTab` and all step children; combined with finding 2 this doubles the per-stream-line work. Bounded (the tree is moderate), but free to fix.
- **Fix sketch**: After running the sub-reducers, compare each returned slice to `state` by reference; if all four are unchanged, `return state`. Since sub-reducers already return the same object for no-ops, a four-way `===` check suffices (note the sub-reducers currently receive the full state as their slice, so give each a stable trimmed slice or compare the specific keys each owns).

## 4. Snapshot section mapping duplicated between polling handler and push-event listener
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_n8n/hooks/useN8nTransform.ts:223
- **Scenario**: `handleSnapshotSections` (lines 223-241) and the `N8N_TRANSFORM_SECTION` push listener (lines 248-263) contain byte-identical `unknown -> StreamingSection` mapping logic (kind/index/label/data/validation coercion). Related: `N8nSessionList.handleLoad` (N8nSessionList.tsx:212-218) re-implements the question-default merge that `QUESTIONS_GENERATED` already performs in transformReducer.ts:65-68.
- **Root cause**: The push-based section event was added after the polling fallback and the mapper was copy-pasted instead of extracted.
- **Impact**: Any change to the `StreamingSection` shape (new field, different validation default) must be made in two places; they will silently drift, and the polling vs push paths will produce differently-shaped sections.
- **Fix sketch**: Extract a `mapUnknownSection(s: unknown): StreamingSection` (and optionally `mapUnknownQuestion`) into `n8nTypes.ts` next to `normalizeDraftFromUnknown`, and call it from both the snapshot handler and the push listener; have `SESSION_LOADED`/`QUESTIONS_GENERATED` share one `mergeQuestionDefaults(questions, answers)` helper.

## 5. useN8nSession unmount flush duplicates both debounced write bodies
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_n8n/hooks/useN8nSession.ts:183
- **Scenario**: The unmount-cleanup effect (lines 183-224) re-implements the exact payload construction of both debounced writers: the 8-field `updateN8nSession({step, status, parserResult, ...})` object literal appears twice (lines 119-128 and 192-201) and the `PersistedTransformContext` localStorage literal appears twice (lines 154-161 and 210-217).
- **Root cause**: Flush-on-unmount was bolted on by copying the timer callbacks instead of extracting the write functions and invoking them from both the timer and the cleanup.
- **Impact**: Adding a field to the DB slice or the persisted context requires editing four sites; the unmount path already drifted subtly (it doesn't check `slicesEqual`, so it can rewrite an unchanged slice).
- **Fix sketch**: Extract `flushDbNow(state)` and `flushLsNow(state)` module-level (or `useCallback`-free, ref-reading) helpers that build the payload from `deriveDbSlice`/`PersistedTransformContext` in one place; the debounce timers and the unmount cleanup both call them.
