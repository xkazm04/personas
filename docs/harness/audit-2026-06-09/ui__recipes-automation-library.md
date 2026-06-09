# UI Perfectionist — recipes-automation-library
> Total: 6
> Severity: 0 critical, 3 high, 3 medium, 0 low

## 1. List loading state is never rendered — empty state flashes on every open
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/recipes/sub_manager/components/RecipeManager.tsx:19, 126-140 (and src/features/recipes/sub_list/components/RecipeList.tsx:58-72)
- **Scenario**: User opens the Recipe Library. While `fetchRecipes()` is in flight, `recipes` is still `[]`, so `RecipeList` immediately renders the full first-run empty state ("No recipes yet" + book illustration). On a populated library this is a jarring flash of "you have nothing" before the grid pops in.
- **Root cause**: `RecipeManager` tracks `loading` (line 19) and even uses it for the header subtitle (line 87), but never passes it to `<RecipeList>` (lines 132-138). `RecipeList`'s only branch is `recipes.length === 0` (line 58), which can't distinguish "still loading" from "genuinely empty". The header says "Loading…" while the body says "No recipes" — contradictory states on screen simultaneously.
- **Impact**: error-blind / unpolished — contradictory states; perceived data loss on slow loads.
- **Fix sketch**: Thread `loading` into `RecipeList` (or branch in `RecipeManager` before rendering the list). While `loading && recipes.length === 0`, render a skeleton grid (3-6 placeholder cards matching the `minmax(280px,1fr)` layout) or center the existing `RecipePageFlipLoader`. Only fall through to `EmptyState` once `loading === false`.

## 2. Icon-only buttons rely on `title` only — no accessible name
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/recipes/sub_list/components/RecipeCard.tsx:104-138; src/features/recipes/sub_playground/components/RecipePlaygroundModal.tsx:53-58; src/features/recipes/sub_editor/components/SchemaFieldBuilder.tsx:112-118; src/features/recipes/sub_editor/components/TagChipInput.tsx:46-52; src/features/recipes/sub_list/components/RecipeList.tsx:100-105
- **Scenario**: The card's quick-test/edit/settings/delete buttons, the playground close (X), the schema-field delete (trash), the tag-chip remove (X), and the quick-test dismiss (X) render only a lucide glyph. A screen-reader user hears "button" with no name; `title` is not a reliable accessible name and is invisible to keyboard users.
- **Root cause**: These controls pass `title=` (RecipeCard) or nothing (modal/chip/schema X buttons) but never `aria-label`. `aria-label` is the established pattern elsewhere in the app (e.g. `sub_n8n`, `sub_generated/gallery` use it), so recipes is an inconsistent a11y regression.
- **Impact**: inaccessible — icon-only actions are unnamed for assistive tech.
- **Fix sketch**: Add `aria-label` to every icon-only button using the existing translation strings (`t.recipes.run_quick_test`, `edit_recipe`, `open_settings`, `delete_recipe`, `t.common.close`/`remove`). Keep `title` for the mouse tooltip; add `aria-label` for the accessible name.

## 3. Inconsistent focus treatment across the three sub-areas
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/recipes/sub_list/components/RecipeCard.tsx:107 (uses `focus-ring`) vs src/features/recipes/sub_editor/components/RecipeEditor.tsx:139-145, 147-154; src/features/recipes/sub_playground/components/RecipePlaygroundModal.tsx:53-58, 67-73; src/features/recipes/sub_playground/tabs/RecipeOutputSection.tsx:72-82, 100-110
- **Scenario**: Tabbing through the feature, focus is clearly visible on RecipeCard action buttons (they use the shared `focus-ring` utility) but vanishes on the editor's Back/Save buttons, the playground close button, the tab bar buttons, and the copy buttons — those either have no focus style or use `focus-visible:outline-none` on inputs without a ring replacement on the buttons.
- **Root cause**: `focus-ring` is applied only on cards; editor toolbar, modal chrome, tabs, and copy controls were authored with `hover:` styling but no keyboard-focus affordance, so the three sub-areas don't feel like one feature for keyboard users.
- **Impact**: inaccessible / inconsistency — keyboard focus is invisible on the primary editor and playground actions.
- **Fix sketch**: Apply the same `focus-ring` (or a `focus-visible:ring-2 focus-visible:ring-primary/50` equivalent) to all interactive buttons in `RecipeEditor`, `RecipePlaygroundModal` (close + tabs), and the copy buttons in `RecipeOutputSection`. Inputs that set `focus-visible:outline-none` already pair it with `focus-visible:border-primary/50` — extend that discipline to buttons.

## 4. Two competing primary-button styles + inconsistent run-action color
- **Severity**: medium
- **Category**: visual-hierarchy
- **File**: src/features/recipes/sub_manager/components/RecipeManager.tsx:93-99 (`btn-md ... bg-primary`); src/features/recipes/sub_editor/components/RecipeEditor.tsx:147-154 (hand-rolled `rounded-modal bg-primary px-3 py-1.5`); src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:92-103 (emerald Execute); src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx:122-129 (`bg-primary` Generate)
- **Scenario**: The library's "New recipe" uses the shared `btn-md` token; the editor's Save reimplements the same look with raw padding/radius classes; the playground's primary "Execute" action is emerald while "Generate new version" (also a primary CTA) is `bg-primary`. The same conceptual "run/commit" action looks different in each sub-area.
- **Root cause**: No single primary-button component/recipe is used across the feature. `Save` duplicates `btn-md` markup instead of reusing it, and the run-action color (emerald vs primary) was chosen per-screen rather than from one rule (e.g. "execution = emerald, persistence = primary").
- **Impact**: inconsistency — primary actions don't read as the same weight across manager/editor/playground.
- **Fix sketch**: Route all primary buttons through the existing `btn-md`/primary recipe so Save and New-recipe share one definition. Pick one convention for run-style actions (emerald for "execute/run", primary for "save/generate/accept") and apply it consistently — Execute (emerald) and Accept-apply (emerald, already correct) vs Generate-new-version (make consistent with that rule).

## 5. Card category badge shows raw, untranslated, lowercase value (inconsistent with editor/overview)
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/recipes/sub_list/components/RecipeCard.tsx:87-91
- **Scenario**: On a recipe card the category badge prints the raw stored string (e.g. `automation`, lowercase, untranslated). The editor's category `<select>` (RecipeEditor.tsx:191-195) and the overview tab use the translated label set (`t.recipes.editor.categories[...]`). So the same category renders as a polished localized label in two places and as a bare lowercase token on the card.
- **Root cause**: `RecipeCard` interpolates `{recipe.category}` directly instead of mapping through the translation table the editor already maintains. The icon/color maps (CATEGORY_*) are keyed off the lowercase value but the human-facing label was never localized.
- **Impact**: inconsistency — untranslated, casing mismatch with the rest of the feature.
- **Fix sketch**: Render the badge label via the same `t.recipes.editor.categories[category]` lookup used in the editor (with a capitalized/raw fallback for unknown categories). Keep the existing color/icon resolution unchanged.

## 6. Playground output placeholders + error block are unpolished and offer no recovery
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/recipes/sub_playground/tabs/RecipeOutputSection.tsx:48-53, 84-90, 126-134
- **Scenario**: Before a run, the Rendered-Prompt and Execution-Result panels show a single flat line of muted text inside a bordered box ("Run to see the prompt" / "Execute to see output") with no icon or visual anchor — they look like empty error boxes rather than intentional "ready" states. When a run fails, the error renders as a plain red strip (lines 49-53) with the raw message and no Retry affordance, even though `onExecute` is readily available.
- **Root cause**: The pre-run states are inline `<div>` text rather than a lightweight empty-state treatment (icon + caption), so they don't match the polished `EmptyState`/`SchemaParseErrorBanner` patterns used elsewhere in the feature. The error branch has no action button, unlike the Versions tab which at least surfaces errors near a re-runnable control.
- **Impact**: unpolished / error-blind — failed runs are a dead end; idle panels read as broken.
- **Fix sketch**: Give the two idle panels a small centered icon (BookOpen / Play) + caption to read as deliberate "ready" states. For the error block, mirror `SchemaParseErrorBanner`'s structure (icon + message) and add a "Try again" button wired to `onExecute` so a failed run is recoverable in place.
