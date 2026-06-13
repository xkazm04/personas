> Total: 9 findings (0 critical, 4 high, 4 medium, 1 low)

## 1. Placeholder, hover, and secondary text all collapse to `text-foreground`
- **Severity**: high
- **Category**: hierarchy
- **File**: src/features/recipes/sub_editor/components/RecipeEditor.tsx:167; sub_playground/tabs/RecipeInputSection.tsx:117-119,152; sub_playground/tabs/RecipeOutputSection.tsx:57,74,87; sub_playground/tabs/RecipeOverviewTab.tsx:24-29
- **Problem**: Almost every secondary string in these surfaces uses `text-foreground` — including `placeholder:text-foreground`, field-type hints `({field.type})`, "run to see prompt" empty hints, metadata labels, hover targets like `hover:text-foreground`, and "remove" buttons. Placeholder text rendered at full foreground color is indistinguishable from typed input, and `hover:text-foreground` on an element that is already `text-foreground` is a no-op — the hover affordance silently does nothing. The whole recipe surface reads flat: there is no visual separation between labels, values, hints, and active content. This is systemic across all three sub-features.
- **Fix sketch**: Use the muted/secondary token (`text-muted-foreground`) for placeholders, hints, metadata, and resting icon-button color, reserving `text-foreground` for primary content; give hover targets a real delta (`text-muted-foreground hover:text-foreground`). Audit every `placeholder:text-foreground` → `placeholder:text-muted-foreground`.

## 2. Hand-rolled buttons everywhere instead of the catalog `Button`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/recipes/sub_manager/components/RecipeManager.tsx:93-99; sub_editor/components/RecipeEditor.tsx:139-154; sub_playground/tabs/RecipeInputSection.tsx:73-103; sub_playground/tabs/RecipeVersionsTab.tsx:129-136,196-219
- **Problem**: Every primary/secondary action is a raw `<button>` with bespoke `bg-primary px-3 py-1.5 ... hover:bg-primary/90 disabled:opacity-40 transition-colors` strings, re-implemented slightly differently in each file (the editor toolbar uses `rounded-modal px-3 py-1.5`, the manager uses `btn-md`, the versions tab uses `px-4 py-2`). The catalog explicitly says "Never style a raw `<button>`." The result is inconsistent padding/radius/disabled treatment across the recipe area and no shared focus-ring.
- **Fix sketch**: Replace with `Button` (variant `primary`/`ghost`/`secondary`, `size`, `icon`). For the async Save/Accept/Execute actions use `AsyncButton`, which gives the in-flight spinner + auto-disable for free (removing the manual `saving`/`accepting` spinner wiring).

## 3. Raw `<select>` instead of `Listbox`/`ThemedSelect`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/recipes/sub_editor/components/RecipeEditor.tsx:186-195; sub_editor/components/SchemaFieldBuilder.tsx:93-101; sub_playground/tabs/RecipeInputSection.tsx:122-130
- **Problem**: Three native `<select>` elements (category, schema field type, playground enum input). Native selects render with OS-default chrome that ignores the app theme entirely — wrong font, wrong popup background, no theme/dark-light parity — and look visibly foreign next to the themed inputs beside them. The catalog ships `Listbox` ("use instead of raw `<select>`") and `ThemedSelect` precisely for this.
- **Fix sketch**: Swap each `<select>` for `Listbox`/`ThemedSelect`, mapping the same option arrays. Keeps keyboard a11y and gives themed popup styling consistent with the rest of the editor.

## 4. Run/Execute and "saved" feedback hard-code emerald instead of `statusTokens.success`
- **Severity**: high
- **Category**: token
- **File**: src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:86,95-99,139; sub_playground/tabs/RecipeOutputSection.tsx:77,105; sub_playground/tabs/RecipeVersionsTab.tsx:199-201
- **Problem**: The Execute button, boolean-field "true" pill, "Saved"/"Copied" checks, and Accept button all hard-code `bg-emerald-500/10 border-emerald-500/20 text-emerald-400` — which is exactly the literal value of `statusTokens.success` (`text-emerald-400` / `bg-emerald-500/10` / `border-emerald-500/30`). Duplicating the token inline means a theme or success-color change won't reach these primary run-feedback affordances, and the border opacity already drifts (`/20` here vs `/30` in the token). Error blocks have the same problem with raw `red-500/red-400` (RecipeOutputSection.tsx:50, RecipeVersionsTab.tsx:161) vs `statusTokens.error`.
- **Fix sketch**: Pull classes from `statusTokens.success` / `statusTokens.error` (or use `StatusBadge`/`ErrorBanner` for the pill and error blocks). The most-watched surface in this feature — the run button and its result — must be token-driven.

## 5. Overview "Input Fields" hand-builds a `<table>` instead of `UnifiedTable`
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/recipes/sub_playground/tabs/RecipeOverviewTab.tsx:56-76
- **Problem**: A raw `<table>` with hand-styled `<thead>`/`<tbody>`, manual `border-b border-border/20` row separators, and `bg-muted/20` header. Row separators bypass the `ROW_SEPARATOR` token (`border-primary/[0.06]`) used elsewhere, so the divider weight differs from every other list in the app, and the header/zebra styling won't match other tables.
- **Fix sketch**: Render via the catalog table (`UnifiedTable`) with column defs for key/type/label, or at minimum apply `ROW_SEPARATOR` to the row borders for separator consistency.

## 6. Copy buttons re-implement `CopyButton` (and lose hover affordance)
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/recipes/sub_playground/tabs/RecipeOutputSection.tsx:72-82,100-110
- **Problem**: Both "Copy prompt" / "Copy output" buttons hand-wire `useCopyToClipboard` + a Copy/Check icon swap + `hover:text-foreground` (a no-op per finding #1). The catalog `CopyButton` provides exactly this with built-in copied feedback and correct theming — "use instead of raw clipboard writes."
- **Fix sketch**: Replace both with `CopyButton` passing the prompt/output string; deletes the local `copied`/`copy` state and gives consistent feedback + a working hover state.

## 7. Tag pills are inconsistent between editor, overview, and the catalog `Badge`
- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/recipes/sub_editor/components/TagChipInput.tsx:41-44 vs sub_playground/tabs/RecipeOverviewTab.tsx:41-45
- **Problem**: The same logical object (a recipe tag) renders as a `bg-primary/10 text-primary` pill in the editor but as a `border-border/50 bg-muted/30 text-foreground` pill in the overview tab. A user editing tags then viewing the recipe sees two different visual languages for one concept. Neither uses the catalog `Badge`.
- **Fix sketch**: Standardize on the catalog `Badge` component for tag display in both places so the chip in the editor matches the chip in overview/history.

## 8. Search input X-clear and editor toolbar lack `focus-ring`; icon-only buttons inconsistent
- **Severity**: medium
- **Category**: a11y
- **File**: src/features/recipes/sub_manager/components/RecipeManager.tsx:105,112-121; sub_playground/components/RecipePlaygroundModal.tsx:53-59
- **Problem**: The search input only styles `focus-visible:border-primary/50` with `focus-visible:outline-none` — it drops the app's standard `focus-ring` utility, so keyboard focus is a faint border instead of the visible ring used app-wide. The clear-search `<button>` has no `aria-label` and no focus-ring. The leading search icon uses `text-foreground` (should be muted, per #1). These are repeated for every bespoke input across the feature.
- **Fix sketch**: Apply the globals `focus-ring` utility to inputs/buttons instead of re-implementing focus styling; add `aria-label` to the icon-only clear button (the modal close button at :55 already does this correctly — match it).

## 9. Free-input fallback drops the structured "saved mock values" panel layout
- **Severity**: low
- **Category**: polish
- **File**: src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:158-166
- **Problem**: When a recipe has no schema fields, the left column becomes a bare textarea while the right "Saved Mock Values" panel still renders an empty-state box — the two columns are visually unbalanced (a tall plain textarea beside a short bordered card) and the "Save mock values" affordance is hidden because it is gated on `fields.length > 0`, so free-input runs can never persist sample inputs.
- **Fix sketch**: Give the free-input textarea the same card framing as the schema fields, and either expose a save affordance for free input or hide the mock-values column when there is no schema so the grid doesn't render a lopsided empty half.
