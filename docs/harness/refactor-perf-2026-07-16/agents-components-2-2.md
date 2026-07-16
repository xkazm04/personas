# agents/components [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 1 medium / 3 low)
> Context group: Persona Authoring & Design | Files read: 6 | Missing: 0

## 1. CompletenessRing.tsx is dead code — zero importers in the entire src tree
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/components/allPersonas/CompletenessRing.tsx:4
- **Scenario**: Repo-wide grep for `CompletenessRing` finds only the file itself, a comment in `src/lib/personas/personaThresholds.ts:11`, and stale entries in context-map/lint artifacts. No component or test imports it, and the name never appears in any lazy-import/registry string, so dynamic use is ruled out.
- **Root cause**: The persona-table completeness ring's call site was removed or replaced during an overview redesign, leaving the component file behind.
- **Impact**: 33 lines of unmaintained UI that will silently drift from the design system; the `personaThresholds.ts` comment pointing at it misleads readers into thinking `completenessColor` has a ring consumer.
- **Fix sketch**: Delete `CompletenessRing.tsx`. Then check remaining callers of `completenessColor` in `personaThresholds.ts` — if the ring was its only consumer, remove the helper and its comment block too; otherwise just fix the comment.

## 2. useTemplateIntentMatch returns a `loading` flag its only consumer never uses
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/components/create/useTemplateIntentMatch.ts:27
- **Scenario**: The sole caller, `BuildTemplateSuggestion.tsx:56`, destructures only `{ matches }`. The docstring's rationale for `loading` ("the caller can keep the curated starters visible") describes a consumer that no longer exists.
- **Root cause**: The hook was written for the unified-creator flow (per its docstring) and later rewired to the matrix build entry, which never adopted the loading state.
- **Impact**: Dead API surface plus wasted work: every debounced request cycle fires `setLoading(true)` then `setLoading(false)`, forcing two extra renders of `BuildTemplateSuggestion` per keystroke burst for a value nobody reads. Also, the hook lives under `create/` while its only consumer is under `matrix/` — a stale location.
- **Fix sketch**: Drop the `loading` state and return `matches` directly (or keep the object shape minus `loading`). Consider moving the file next to its consumer under `matrix/` while touching it. If a future caller needs a spinner, reintroduce `loading` then.

## 3. Fourth hand-rolled debounced-intent-matcher — consolidate on one hook
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/components/create/useTemplateIntentMatch.ts:22
- **Scenario**: `useTemplateIntentMatch` reimplements the same pattern as `sub_glyph/useRecipeStarters.ts` (300ms debounce, MIN_LEN gate, request-id staleness guard, best-effort empty-on-error) and the inline fetch logic in `ComposerRecipeSuggestion.tsx` and `TemplateSuggestionsWidget.tsx` — four copies differing only in command name, min-length, and result type.
- **Root cause**: Each intent-matching surface (glyph composer, home widget, matrix build entry) grew its own copy instead of extracting the shared debounce/stale-guard skeleton after the second occurrence.
- **Impact**: The staleness/cleanup semantics have already diverged (this hook clears matches below MIN_CHARS inside the debounced run; `useRecipeStarters` clears synchronously; the widget has no debounce at all), so a fix to one guard won't propagate — classic drift hazard for four hot typing paths.
- **Fix sketch**: Extract a generic `useDebouncedIntentMatch<T>(intent, fetcher, { minLen, debounceMs })` in `src/hooks/` that owns debounce + request-id + error-to-empty, and rebase `useTemplateIntentMatch` and `useRecipeStarters` on it (the widget/composer can follow later). Keep per-caller min-length as an option.

## 4. useTemplateIntentMatch does not invalidate in-flight requests on unmount
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/agents/components/create/useTemplateIntentMatch.ts:59
- **Scenario**: The effect cleanup clears only the debounce timer. If the build-entry suggestion panel unmounts while `companionMatchTemplates` is awaiting the Tauri backend, the resolution still runs `setMatches`/`setLoading` against the unmounted component.
- **Root cause**: `reqIdRef` guards against out-of-order responses between keystrokes but is never bumped on unmount, so the last in-flight response always passes the `requestId === reqIdRef.current` check.
- **Impact**: Bounded — React 18+ no-ops post-unmount state updates — but the promise continuation and captured state setters stay alive longer than needed, and the hook already owns the exact mechanism to prevent it.
- **Fix sketch**: In the effect cleanup, add `reqIdRef.current++` alongside `clearTimeout`, so any in-flight response fails the request-id check and is dropped, mirroring the keystroke-supersede path.
