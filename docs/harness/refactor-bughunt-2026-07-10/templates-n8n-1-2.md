> Context: templates/n8n [1/2]
> Total: 10
> Critical: 0  High: 1  Medium: 5  Low: 4

## 1. N8nQuestionStepper crashes when the questions array shrinks under a stale activeIndex
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src/features/templates/sub_n8n/widgets/N8nQuestionStepper.tsx:68-70,132-171
- **Scenario**: The stepper holds `activeIndex` in local state and never re-clamps it to `questions.length`. If the `questions` prop is replaced by a shorter array while the component stays mounted (e.g. a Turn-2 background snapshot re-dispatches `QUESTIONS_GENERATED` with fewer items while `transformSubPhase` is still `answering`, so N8nTransformChat keeps the stepper mounted), and the user was on a high index, then `const q = questions[activeIndex]!` is `undefined` and the very next `q.question` / `q.category` / `q.type` access throws a TypeError, white-screening the wizard step.
- **Root cause**: `activeIndex` is only bounded inside `goTo` (navigation); nothing reconciles it when the `questions` identity/length changes out from under the component.
- **Impact**: crash (blank wizard, lost in-progress answers).
- **Fix sketch**: Add an effect/guard that clamps: `useEffect(() => { if (activeIndex > questions.length - 1) setActiveIndex(Math.max(0, questions.length - 1)); }, [questions.length])`, and/or guard `const q = questions[activeIndex]; if (!q) return null;`.

## 2. Streaming sections are appended without dedup → duplicate rows and duplicate React keys
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/features/templates/sub_n8n/reducers/transformReducer.ts:106-107; src/features/templates/sub_n8n/hooks/useN8nTransform.ts:243-294
- **Scenario**: `useN8nTransform` feeds sections from TWO sources simultaneously: the push event `N8N_TRANSFORM_SECTION` (`TRANSFORM_SECTION_PUSH`, which does `[...slice.streamingSections, action.section]`) and the polling snapshot `onSections` (`TRANSFORM_SECTIONS`, which replaces the array). `TRANSFORM_SECTION_PUSH` never dedups by `index`/`kind`. If the backend re-emits a section, or a push and a snapshot interleave, the same section is stored twice. StreamingSections renders with `key={`${section.kind}-${section.index}`}`, so duplicates produce React duplicate-key warnings and the header valid/warning/error tallies double-count.
- **Root cause**: Append-only push merge with no reconciliation against existing indices, combined with a second replace-based feed for the same data.
- **Impact**: UX (duplicated section rows, wrong counts), console noise, potential mis-render on reconcile.
- **Fix sketch**: In `TRANSFORM_SECTION_PUSH`, upsert by `(kind,index)`: replace an existing entry with the same key or append if absent.

## 3. Global keydown listener in the stepper hijacks Arrow keys document-wide
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src/features/templates/sub_n8n/widgets/N8nQuestionStepper.tsx:56-66
- **Scenario**: While the stepper (focus view) is mounted during the `answering` phase, it attaches a `document`-level `keydown` handler that calls `preventDefault()` on ArrowLeft/ArrowRight for the whole page (it only bails for INPUT/TEXTAREA/SELECT). Any other arrow-key affordance on the page that isn't one of those three tags — e.g. the custom `N8nQuestionListbox` (button/role=listbox), horizontal scroll, or a focused card — has its Left/Right swallowed and repurposed to flip questions.
- **Root cause**: Page-global capture of a common navigation key instead of scoping the listener to the stepper element.
- **Impact**: UX/a11y (keyboard navigation elsewhere behaves unexpectedly while questions are shown).
- **Fix sketch**: Attach the handler to the stepper container ref (or a `tabIndex` wrapper) rather than `document`, or only `preventDefault` when the event target is within the stepper.

## 4. extractSurroundingContext computes a bogus end offset when the match has no trailing newline
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/templates/sub_n8n/edit/protocolParser.ts:135-154
- **Scenario**: `end = Math.min(text.length, Math.min(period+1 || len, text.indexOf('\n', …) || len))`. When there is no newline after the keyword, `indexOf` returns `-1`, and `-1 || text.length` evaluates to `-1` (because `-1` is truthy). The inner `Math.min(..., -1)` then yields `-1`, so `text.slice(start, -1)` drops the last character and ignores the sentence/line boundary entirely. E.g. a single-line prompt `"notify the user when done"` yields the whole string minus its last char instead of a bounded snippet.
- **Root cause**: `||` used as a not-found guard where the sentinel (`-1`) is truthy; only the period branch (`+1`) accidentally guards correctly.
- **Impact**: UX (capability tooltip/context text is malformed/over-long).
- **Fix sketch**: Normalize each index first: `const nl = text.indexOf('\n', …); const nlEnd = nl === -1 ? text.length : nl;` (same for the period), then `Math.min`.

## 5. DB-sync effect depends on the entire `state` object, re-running on every transient change
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/templates/sub_n8n/hooks/useN8nSession.ts:101-141
- **Scenario**: The debounced SQLite-sync `useEffect` dependency array already enumerates the specific slices it cares about, but also includes the whole `state`. That makes it re-run on unrelated high-frequency changes (`transformLines` arriving many times/second during streaming, `adjustmentRequest` keystrokes), each time tearing down and re-arming the 600 ms timer. The `slicesEqual` guard prevents a redundant *write*, but the effect churn is unnecessary and makes the debounce behave differently than the explicit deps suggest.
- **Root cause**: Redundant `state` entry alongside the explicit slice deps (belt-and-suspenders that defeats the debounce intent).
- **Impact**: maintainability/perf (effect thrash; misleading dependency contract).
- **Fix sketch**: Drop the trailing `state` from the dep array (the explicit slice deps + `latestStateRef` already cover freshness), or rely solely on `latestStateRef` and a minimal trigger set.

## 6. Dead component: WorkflowThumbnail.tsx is never imported
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/templates/sub_n8n/widgets/WorkflowThumbnail.tsx:1-185
- **Scenario**: Grepped the whole `src` tree for `WorkflowThumbnail` — the only hits are its own definition; no import, no barrel re-export, no Tauri/dynamic usage. The ~185-line component (IntersectionObserver + SVG node-graph renderer) is fully unreferenced.
- **Root cause**: Leftover from a previous session-list/thumbnail design that was removed from N8nSessionList.
- **Impact**: maintainability (dead surface area carries its own trigger-detection helpers and observer lifecycle).
- **Fix sketch**: Delete the file; if the thumbnail is a planned feature, keep it behind a tracked TODO rather than compiled-but-dead.

## 7. Dead + duplicated component: PersonaPreviewCard.tsx
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/templates/sub_n8n/steps/PersonaPreviewCard.tsx:1-207
- **Scenario**: `PersonaPreviewCard` is never imported (the only non-definition reference is a JSDoc mention in PersonaEntitySummary.tsx). Its body is a near-verbatim duplicate of the inline persona-preview block in N8nConfirmStep.tsx:92-208 (same avatar/color style, PersonaEntitySummary, tag lists, capability badges, tool-credential warning, collapsible prompt). It also re-implements the capability/tag color maps inline instead of using colorTokens.
- **Root cause**: Component was extracted for reuse but the confirm step kept (and evolved) its own inline copy; the extraction was left orphaned.
- **Impact**: maintainability (two copies drift; e.g. the inline version uses `text-amber-400/70` while this uses `/60`).
- **Fix sketch**: Either delete PersonaPreviewCard, or make N8nConfirmStep consume it and delete the inline copy — then source badge styles from colorTokens `CAPABILITY_SPLIT_STYLES`/`TAG_COLORS`.

## 8. Duplicated question-rendering logic between stepper and list view (plus a translation gap)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/templates/sub_n8n/widgets/N8nQuestionStepper.tsx:8-14,132-171; src/features/templates/sub_n8n/widgets/N8nQuestionListView.tsx:12-18,81-120
- **Scenario**: Both components independently define the dimension icon map (`DIMENSION_LABELS`/`DIMENSION_ICONS`), the per-index tone palette, and the identical `select`/`text`/`boolean` input rendering (same `N8nQuestionListbox`, same `userAnswers[q.id] ?? q.default ?? ''`, same Yes/No fallback). Beyond duplication, there's a real inconsistency: the stepper hardcodes English `DIMENSION_LABELS` ('Credentials', 'Human in the Loop', …) while the list view pulls translated `t.templates.questionnaire.category_labels` — so category headers are untranslated in focus view.
- **Root cause**: Two parallel view modes built by copy-paste rather than sharing a `QuestionInput` + dimension-meta module.
- **Impact**: maintainability + i18n bug (stepper category labels ignore locale).
- **Fix sketch**: Extract a shared `QuestionInput` component and a single dimension-meta map (translated), consume from both views.

## 9. Session-load step-routing logic is duplicated in two places
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/templates/sub_n8n/steps/N8nSessionList.tsx:185-209; src/features/templates/sub_n8n/hooks/useN8nImportReducer.ts:220-250
- **Scenario**: `N8nSessionList.handleLoad` computes `targetStep`/`subPhase` with a draft→edit / parsedResult→analyze / else→upload cascade, then `handleSessionLoaded` re-derives `safeStep` with the same cascade (overriding the payload's `step`). The routing precedence lives in both spots and can silently diverge.
- **Root cause**: The reducer defensively re-runs precondition-based routing that the caller already performed.
- **Impact**: maintainability (two sources of truth for restore-step selection).
- **Fix sketch**: Centralize the cascade in one helper (e.g. in the reducer module) and have the list call it, so both paths agree by construction.

## 10. Duplicated TagList helper + inline color maps across confirm/preview surfaces
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/templates/sub_n8n/steps/confirm/N8nConfirmStep.tsx:221-240; src/features/templates/sub_n8n/steps/PersonaPreviewCard.tsx:182-206
- **Scenario**: Both files define a local `TagList` component with the same props (`{key,label,title}[]`, `color`), and both hand-roll capability/tag color lookups (N8nConfirmStep uses colorTokens `TAG_COLORS`/`CAPABILITY_SPLIT_STYLES`, PersonaPreviewCard inlines its own `tagColorMap`/`styles` objects that partly restate colorTokens with different opacities).
- **Root cause**: Small presentational helper copied rather than shared; PersonaPreviewCard predates/ignored colorTokens.
- **Impact**: maintainability (palette edits must be made in multiple places; opacities already drift).
- **Fix sketch**: Promote a single `EntityTagList` to a shared module keyed off colorTokens; delete the inline color maps (resolves alongside finding #7).
