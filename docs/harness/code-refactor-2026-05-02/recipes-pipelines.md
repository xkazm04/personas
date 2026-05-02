# Code Refactor Scan — Recipes & Pipelines

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~40

## Summary

The Recipes & Pipelines context is generally well-structured (each `sub_*` folder cleanly separates list/editor/playground/canvas/teamMemory concerns, and shared utilities live in dedicated `shared/` and `libs/` folders). The dominant problems are (1) **duplication of small parser/format utilities** that already exist either in a sibling `shared/recipeParseUtils.ts` or in the global `lib/utils/formatters.ts`, and (2) **partial-extraction debt in the canvas**: handlers were split into a `useCanvasHandlers` hook but two of them are still re-implemented in `TeamCanvas.tsx`, leaving exported-but-unused versions in the hook. There is also a small constellation of design-system color constants for pipeline edges/roles defined twice in different files. None of these are breaking — they're the kind of accumulated near-duplication that tends to drift if left.

## 1. `parseInputSchema` is defined twice with the same name

- **Severity**: high
- **Category**: duplication
- **File**: src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:14-22 and src/features/recipes/shared/recipeParseUtils.ts:45-53
- **Scenario**: Two functions named `parseInputSchema`, same signature `(schema: string | null) => { fields, parseError }`, near-identical implementations. The shared one returns `InputSchemaResult` with `InputSchemaField[]`, the playground one returns `InputFieldResult` with a richer `InputField[]` (adds `default`/`options`). Both consume `recipe.input_schema`.
- **Root cause**: The shared util was added later (or in parallel) to back `RecipeOverviewTab` + `RecipeCard`, but `RecipeTestRunnerTab` already had its local copy and was never migrated.
- **Impact**: Two sources of truth for "what is a recipe's input schema." A schema-format change (e.g. supporting `enum` instead of `options`) will silently update one tab and not the other. The function-name collision also makes grep/jump-to-def confusing for readers.
- **Fix sketch**:
  - Promote `InputField` (with `default`/`options`) into `shared/recipeParseUtils.ts` as the canonical type.
  - Delete `recipeTestHelpers.parseInputSchema`; re-export the shared one (or just import it from `RecipeTestRunnerTab`).
  - Keep `parseMockValues` and `formatOutputForMarkdown` in `recipeTestHelpers.ts` — those are playground-specific.

## 2. RecipeEditor reimplements parseTags / parseSchemaFields locally

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/recipes/sub_editor/components/RecipeEditor.tsx:20-44
- **Scenario**: `parseTagsString` (line 20) and `parseSchemaString` (line 30) are byte-for-byte equivalent to `parseTags` and `parseSchemaFields` exported from `src/features/recipes/shared/recipeParseUtils.ts`. The shared versions even export `SchemaFieldParsed` which matches `SchemaField` here.
- **Root cause**: The shared util file was created but the editor was never refactored to consume it. `parseSchemaFields` in shared has zero callers as a result.
- **Impact**: `parseSchemaFields` in `recipeParseUtils.ts` is dead exported code (Finding #3). Future edits to tag/schema parsing have to be made in two places, with TagChipInput, SchemaFieldBuilder, and overview tab silently diverging.
- **Fix sketch**:
  - Replace the two private functions in RecipeEditor with `import { parseTags, parseSchemaFields } from '@/features/recipes/shared/recipeParseUtils'`.
  - Align `SchemaField` with `SchemaFieldParsed` (rename or re-export).

## 3. `parseSchemaFields` is exported but never imported

- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/recipes/shared/recipeParseUtils.ts:29-43
- **Scenario**: Project-wide grep for `parseSchemaFields` returns only the definition. RecipeEditor uses its own local copy (`parseSchemaString`) instead.
- **Root cause**: Likely added speculatively when refactoring `RecipeOverviewTab`, intended to be the migration target for RecipeEditor, but the editor wasn't migrated.
- **Impact**: Misleads readers — looks like an established utility. Tied to Finding #2.
- **Fix sketch**:
  - Either delete it, or fold it into the cleanup of Finding #2 by switching RecipeEditor to use it.

## 4. `handleUpdateNote`/`handleDeleteNote` defined in both useCanvasHandlers and TeamCanvas

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/pipeline/components/canvas/useCanvasHandlers.ts:75-82 (returned at :198) and src/features/pipeline/components/TeamCanvas.tsx:58-65
- **Scenario**: `useCanvasHandlers` defines `handleUpdateNote` and `handleDeleteNote` and exports them in its return object. `TeamCanvas.tsx` then re-implements both inline (identical logic) and uses *those* in `stickyNodes`. The hook's versions are never consumed.
- **Root cause**: The handlers were probably moved from `TeamCanvas` into `useCanvasHandlers` during a refactor, but the call sites in `TeamCanvas` weren't updated and the originals weren't removed.
- **Impact**: Reader confusion ("which handler is the real one?"), drift risk (categories or sticky-note model change → two places to update), bundle bloat. Already a real pitfall — dispatch shape changes would compile in one place and silently still fail at runtime.
- **Fix sketch**:
  - Delete `handleUpdateNote` + `handleDeleteNote` from `useCanvasHandlers` (and from its returned object).
  - Keep the inline ones in `TeamCanvas.tsx` since they're consumed locally there.

## 5. Pipeline color/role constants split across two files

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/pipeline/components/templates/pipelineTemplateTypes.ts:30-42 and src/features/pipeline/sub_canvas/libs/teamConstants.tsx:13-36
- **Scenario**: `EDGE_COLORS` (templateTypes) and `CONNECTION_TYPE_STYLES` (teamConstants) carry the same four hex colors for `sequential`/`conditional`/`parallel`/`feedback`. `NODE_ROLE_FILLS` (templateTypes) carries hex equivalents of `ROLE_COLORS` (teamConstants) for the four roles. The template gallery uses `EDGE_COLORS` + `NODE_ROLE_FILLS` for SVG fills; the live canvas uses `CONNECTION_TYPE_STYLES.stroke` + `ROLE_COLORS` Tailwind classes.
- **Root cause**: Templates render to SVG (need raw hex), the canvas renders DOM (uses Tailwind class strings), so two formats coexist. But the source colors should be identical, and they're maintained independently.
- **Impact**: A brand/design tweak to the connection-type colors (e.g. shifting "feedback" from violet to indigo) will hit one rendering path and not the other. The mini-canvas + gallery cards visually drift from the live canvas.
- **Fix sketch**:
  - Pick `teamConstants.tsx` as canonical (it owns the rendered canvas).
  - Add a `getEdgeHex(type)` helper that returns `CONNECTION_TYPE_STYLES[type].stroke` and a `getRoleHex(role)` from a single hex source.
  - Delete `EDGE_COLORS` and `NODE_ROLE_FILLS` from `pipelineTemplateTypes.ts`; let MiniCanvas/PipelineTemplateGallery import the helpers.

## 6. Two LLM-with-keyword-fallback wrappers for `suggestTopology`

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/pipeline/components/canvas/useCanvasPipelineActions.ts:112-115 (`handleAssistantSuggest`) and src/features/pipeline/components/useAutoTeam.ts:60-65 (inline in `suggest`)
- **Scenario**: Both call sites do `try { suggestTopologyLlm(...) } catch { suggestTopology(...) }` with identical semantics. The canvas-assistant version logs a warn on fallback; the auto-team version swallows silently.
- **Root cause**: Two features (in-canvas assistant chat vs. AutoTeamModal entry point) ship the same fallback pattern independently.
- **Impact**: Fallback policy lives in two places. Adding a timeout, telemetry, or different error-classification strategy means updating both. Already inconsistent (one logs, one doesn't).
- **Fix sketch**:
  - Add a `suggestTopologyWithFallback(query, teamId?)` helper next to `suggestTopology` in `src/api/pipeline/teams.ts` — or in a small `src/features/pipeline/lib/topologySuggest.ts`.
  - Have it own the LLM-first / keyword-fallback policy and the warn log.
  - Both call sites become single-line.

## 7. `formatTime` in TimelineItem reimplements `formatRelativeTime`

- **Severity**: low
- **Category**: duplication
- **File**: src/features/pipeline/sub_teamMemory/components/timeline/TimelineItem.tsx:4-16 (re-exported in sub_teamMemory/index.ts:14)
- **Scenario**: A 12-line "just now / Nm ago / Nh ago / Nd ago / locale-date" function. The codebase already has `formatRelativeTime` in `src/lib/utils/formatters.ts:10-31` doing the same (with the same buckets and a richer `dateFallbackDays` opt). 20+ other features import from there.
- **Root cause**: TimelineItem was written without checking the formatters utility; the local copy diverges trivially (capitalizes "just now" the same way, but uses minutes-only granularity below 1 min instead of the formatter's seconds bucket).
- **Impact**: Inconsistent timestamp text between "X seconds ago" displays elsewhere and "just now" here. Sub-feature exports this private helper through its public `index.ts`, advertising it as part of the API surface.
- **Fix sketch**:
  - Replace the body of `MemoryEntry`/`ManualGroup` with `formatRelativeTime(memory.created_at, '', { dateFallbackDays: 7 })`.
  - Delete `formatTime` and remove it from `sub_teamMemory/index.ts`'s exports.

## 8. `movePersonaToGroup` slice action is wired but never invoked

- **Severity**: medium
- **Category**: dead-code
- **File**: src/stores/slices/pipeline/groupSlice.ts:29 (interface), :110-116 (impl)
- **Scenario**: The slice exposes `movePersonaToGroup(personaId, groupId)`, which only emits a `storeBus.emit('persona:move-to-group', ...)`. Project-wide grep for `.movePersonaToGroup(` returns zero call sites (only test mocks). The bus listener in `storeBusWiring.ts:71-73` is correctly wired and would forward to `applyPersonaOp`, but no UI or store calls the slice action to fire the event.
- **Root cause**: Likely an in-flight DnD-grouping refactor where the consumer (a drag-end handler) was removed or never landed, leaving the action half-wired.
- **Impact**: Misleading API surface — readers will assume "this is how groups get reassigned" and design new UI around it, not realizing the action and its bus listener are unused. The `try/catch` in the impl is also dead since `storeBus.emit` doesn't throw in normal flow.
- **Fix sketch**:
  - Verify (one git log on the file) whether the consumer is pending or removed.
  - If removed: delete `movePersonaToGroup` from the slice + the `'persona:move-to-group'` bus channel + listener.
  - If pending: tag with a `// TODO(group-dnd):` comment so it's not mistaken for shipping API.

## 9. `LinkedRecipesSection` `Add` button has a no-op ternary

- **Severity**: low
- **Category**: cleanup
- **File**: src/features/recipes/sub_list/components/LinkedRecipesSection.tsx:88
- **Scenario**: The button text is rendered as `{t.common.edit ? 'Add' : 'Add'}`. Both branches return the same literal `'Add'`, and the condition probes `t.common.edit` (an unrelated translation key) which makes no sense.
- **Root cause**: Looks like an incomplete i18n migration — someone started extracting "Add" to `t.recipes.add` (or similar) and got interrupted, leaving a placeholder ternary that's a syntactic identity.
- **Impact**: Nit — but it's a giveaway of an unfinished change that escaped review, and it's the only non-translated button label in the file (the rest of the component already uses `t.recipes.*`).
- **Fix sketch**:
  - Add `add` (or reuse an existing key like `t.common.add`) and replace with `{t.recipes.add ?? 'Add'}`.
  - Or, if "Add" should never localize here, just write `Add`.

> Total: 9 findings (2 high, 5 medium, 2 low)
