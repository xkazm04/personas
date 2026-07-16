# templates (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 5 medium / 0 low)
> Context group: Templates & Recipes | Files read: 27 | Missing: 0

## 1. DraftIdentityTab is dead code (zero importers)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/draft-editor/DraftIdentityTab.tsx:22
- **Scenario**: Grep across all of `src/` finds `DraftIdentityTab` referenced only in its own file — no component imports it (DraftEditStep builds its tab list from `earlyTabs`/`BUILTIN_TABS`/`additionalTabs` and never mounts it). Verified repo-wide; no dynamic-import or string-registry usage of the name exists.
- **Root cause**: The identity editing UI was moved into DraftEditStep's inline header (name/description inputs) and the Prompt/Design Context subtabs, leaving this 116-line component orphaned.
- **Impact**: 116 lines duplicating live editing logic (identical name-trim `onBlur` handler, description trimming, DesignContextViewer wiring) that will silently drift from the real UI and mislead future edits.
- **Fix sketch**: Delete `DraftIdentityTab.tsx`. `SectionEditor` and `DesignContextViewer` (its only local imports) remain used elsewhere, so nothing else changes. One `tsc` run confirms no consumer breaks.

## 2. ExploreView ships a prototype dead-end ("detail/adopt would open here")
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/templates/sub_explore/ExploreView.tsx:34
- **Scenario**: On the live Templates → Explore tab, clicking any template/recipe row in DomainLevel2 shows a fixed toast literally reading "Selected {name} — detail/adopt would open here" and nothing else happens. The string is hardcoded English (the rest of level 1 is i18n'd).
- **Root cause**: Level 2 is an acknowledged prototype (file headers say so), but the placeholder selection handler shipped on a production tab wired into DesignReviewsPage.
- **Impact**: Every row click is a user-visible dead end that looks like a bug; the placeholder copy leaks internal prototype language to end users.
- **Fix sketch**: Either wire `onSelect`/`onSelectRecipe` to the existing adoption surfaces (GeneratedReviewsTab adoption flow / recipe detail), or remove the click affordance (drop `cursor-pointer` + `onClick` on rows) until the detail view exists. At minimum replace the literal string with an i18n key.

## 3. Overlay-editor pattern duplicated across SectionEditor, DraftJsonTab, and DesignContextViewer
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/draft-editor/SectionEditor.tsx:50
- **Scenario**: The tricky "transparent textarea over a highlighted underlay + scroll sync" pattern is implemented twice with byte-identical `syncScroll`/`handleScroll` callbacks and near-identical layer CSS (SectionEditor.tsx:50-55 and DraftJsonTab.tsx:43-48, 82-100). Separately, DesignContextViewer.tsx:41-67 re-implements SectionEditor's Eye/Pencil mode-toggle header pill verbatim.
- **Root cause**: DraftJsonTab and DesignContextViewer each grew their own copy of SectionEditor's internals instead of extracting the shared overlay-editor / toggle-header primitives.
- **Impact**: Alignment between the underlay and textarea (padding/line-height/wrap) must be kept in sync in two places; a fix to caret color, scroll sync, or wrapping in one editor won't reach the other. The toggle header triplication invites visual drift.
- **Fix sketch**: Extract an `OverlayHighlightEditor` component taking `value`, `onChange`, and a `renderHighlight(value)` prop (markdown line-classes for SectionEditor, sanitized hljs HTML for DraftJsonTab); it owns the refs, scroll sync, and layer styling. Extract the two-button mode toggle into a small `ModeTogglePill` used by SectionEditor and DesignContextViewer.

## 4. 130 KB recipe index is eagerly bundled and parsed for every Templates page load
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/templates/sub_explore/useExploreCatalog.ts:11
- **Scenario**: `recipeIndex.generated.json` (133,204 bytes) is a static import, and `RECIPES` plus two derived maps (`RECIPES_BY_TEMPLATE`, `RECIPES_BY_DOMAIN`) are built at module-evaluation time. DesignReviewsPage statically imports ExploreView (plus N8nImportTab, RecipesPage, PresetLibraryPage, GeneratedReviewsTab), so the JSON is bundled, parsed, and mapped on every Templates page load — even when the user never opens the Explore tab.
- **Root cause**: Module-level eager data transformation on a static JSON import, reached through a page component that renders all five tab surfaces via static imports instead of lazy ones.
- **Impact**: ~130 KB extra in the templates chunk and JSON parse + three full-array passes on startup of the page, paid unconditionally. Bounded (one-time per app load) but pure waste for the 4 of 5 tabs that don't need it.
- **Fix sketch**: Lazy-load the tab surfaces in DesignReviewsPage (`React.lazy` + the existing ErrorBoundary wrappers already isolate each tab), or at minimum convert the recipe index to `const load = () => import('./recipeIndex.generated.json')` resolved inside `useExploreCatalog`'s effect, building the derived maps once behind a module-level promise cache like `getTemplateCatalog` already does.

## 5. DraftJsonTab re-highlights and re-validates the whole JSON document on every keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/draft-editor/DraftJsonTab.tsx:26
- **Scenario**: Typing in the raw-JSON editor runs, per keystroke: `JSON.parse` of the full draft + `normalizeDraftFromUnknown` (in `handleChange`), then on re-render `hljs.highlight` over the full document followed by `sanitizeHljsHtml` and a `dangerouslySetInnerHTML` swap of the entire highlighted `<pre>`. A persona draft with a long system prompt / design context easily reaches tens of KB, making each keystroke do several full-document passes synchronously on the input path.
- **Root cause**: The highlight memo is keyed on `draftJson`, which changes on every keystroke, and validation is inline in the change handler rather than deferred.
- **Impact**: Perceptible input latency on large drafts (highlight + sanitize + full innerHTML replace per character); wasted CPU on the hottest interaction in the tab. Currently fine for small drafts, degrades linearly with document size.
- **Fix sketch**: Feed the highlight layer through `useDeferredValue(draftJson)` (or a ~150 ms debounce) so typing updates the textarea immediately and the highlighted underlay catches up off the critical path; debounce the parse/normalize validation the same way — the parent only needs `onJsonChange` results for the Next-gate, not per-keystroke.
