# recipes (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Templates & Recipes | Files read: 15 | Missing: 0

## 1. SchemaFieldBuilder row key derived from index + typed value causes remount (and focus loss) on every keystroke
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/recipes/sub_editor/components/SchemaFieldBuilder.tsx:63
- **Scenario**: User types into the "key" input of a schema field in the recipe editor. The `Reorder.Item` key is `` `${index}-${field.key || 'new'}` ``, so each keystroke changes the field's `key`, which changes the React key, which unmounts and remounts the whole row — the input loses focus after every character (and AnimatePresence replays the enter/exit animation). Reordering rows also changes every row's index, forcing full remounts that defeat Reorder's layout animation.
- **Root cause**: React key is computed from mutable row data (index + user-typed `key`) instead of a stable per-row identity.
- **Impact**: User-visible breakage on the main schema-authoring path: can't type more than one character into the key field without re-clicking, plus wasted unmount/mount work and broken drag animations on every reorder.
- **Fix sketch**: Give each `SchemaField` a stable client-side `id` (e.g. `crypto.randomUUID()` assigned in `addField` and when hydrating from `parseSchemaString`), use `key={field.id}` and `value={field}` for `Reorder.Item`, and strip the `id` in `serializeSchema`. Alternatively keep an id-only wrapper array local to the builder.

## 2. RecipeEditor reimplements shared parse utils; shared `parseSchemaFields` is dead code
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/recipes/sub_editor/components/RecipeEditor.tsx:24
- **Scenario**: `parseTagsString` (line 24) and `parseSchemaString` (line 34) are line-for-line duplicates of `parseTags` and `parseSchemaFields` in `src/features/recipes/shared/recipeParseUtils.ts`. A repo-wide grep shows `parseSchemaFields` has zero callers — the shared util that was extracted for exactly this purpose is dead while its clone lives in the editor. `recipeTestHelpers.ts` also carries its own `parseInputSchema` copy alongside the shared one.
- **Root cause**: Utils were extracted to `shared/recipeParseUtils.ts` but the editor (and test-runner tab) were never migrated to import them.
- **Impact**: Three JSON-parsing behaviors that must stay in sync (tags/schema round-trip between editor, card, overview tab) can silently diverge; the dead export misleads readers into thinking it is the live implementation.
- **Fix sketch**: In RecipeEditor, delete `parseTagsString`/`parseSchemaString` and import `parseTags`/`parseSchemaFields` from `../../shared/recipeParseUtils` (the `SchemaFieldParsed` shape already matches `SchemaField`). Point `RecipeTestRunnerTab` at the shared `parseInputSchema` and delete the helper copy, or delete the shared one if the helper's return shape genuinely differs.

## 3. Quick-test state in RecipeList re-renders every unmemoized RecipeCard
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/recipes/sub_list/components/RecipeList.tsx:85
- **Scenario**: Running a quick test on one card updates `quickTestLoading`/`quickTestResults` state at the list level (twice per run: start + finish), re-rendering the whole grid. `RecipeCard` is not memoized, and each render re-runs `parseTags` (a `JSON.parse`) per card (RecipeCard.tsx:59). Typing in the manager's search box likewise re-renders all remaining cards every keystroke.
- **Root cause**: Per-card transient state hoisted to the list without memoizing the card; `handleQuickTest` is also rebuilt whenever `recipes` changes, so its identity can't help a memo without fixing deps.
- **Impact**: O(n) card re-renders (each with a JSON.parse and non-trivial JSX) per keystroke and per quick-test tick; noticeable jank once the recipe catalog grows past a few dozen entries.
- **Fix sketch**: Wrap `RecipeCard` in `React.memo` and move `parseTags` behind `useMemo` keyed on `recipe.tags`. Make `handleQuickTest` stable by looking the recipe up via a ref or by passing the recipe object from the card instead of an id, so memoized cards actually skip.

## 4. Nonsense ternary and hardcoded English strings in LinkedRecipesSection
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/recipes/sub_list/components/LinkedRecipesSection.tsx:88
- **Scenario**: The add button renders `{t.common.edit ? 'Add' : 'Add'}` — both branches are the identical hardcoded literal, so the i18n lookup is decorative. The section header (line 82) also hand-builds `"N linked recipe(s)"` in English, and the three toasts (lines 34/52/62) are hardcoded, while every sibling component in this context uses `t.recipes.*`.
- **Root cause**: Leftover placeholder from before the i18n pass; the ternary looks like an aborted attempt to pick a translation key.
- **Impact**: Untranslatable UI strings in an otherwise fully localized feature, plus a confusing no-op conditional that trips up readers.
- **Fix sketch**: Replace the ternary with a proper `t.recipes.*` key (add one if missing), move the linked-count label to an interpolated/plural-aware translation, and route the three toast messages through the catalog like `RecipeManager` should as well (its `'Loading...'` at RecipeManager.tsx:88 and `'Failed to load recipes'` share the issue).

## 5. Dead `deleteTimerRef` in RecipeCard
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/recipes/sub_list/components/RecipeCard.tsx:61
- **Scenario**: `deleteTimerRef` is written inside the auto-dismiss effect (line 66) but never read anywhere — the effect already clears the local `timer` in its own cleanup, so the ref serves no purpose.
- **Root cause**: Leftover from an earlier implementation that cleared the timer imperatively before the cleanup-based version landed.
- **Impact**: Pure noise: an extra `useRef` plus a misleading hint that some other code path cancels the timer.
- **Fix sketch**: Delete the `deleteTimerRef` declaration and the `deleteTimerRef.current = timer;` assignment; keep the effect's local `timer` + cleanup as-is.
