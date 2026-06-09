# Audit Fix Wave 13 — Error-blind / missing-state highs (Tier-3)

> 3 commits, 3 of the 17 missing-state highs closed — the ones whose loading/error signal could be threaded without restructuring a hook or hunting a caller.
> Theme: the same Wave-7 mental model at high severity — a fetched surface must distinguish loading / error / empty(success); collapsing any of those into "empty" is error-blind.
> Baseline preserved: `tsc --noEmit` 0; eslint 0 errors.
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `2d0b87201` | recipes #1 — list flashes "no recipes" while loading | `recipes/sub_list/RecipeList.tsx`, `recipes/sub_manager/RecipeManager.tsx` |
| `6f722b13f` | test-suites #1 — regression table empty masquerades as no-data | `agents/sub_lab/components/versions_table/LabVersionsTable.tsx` |
| `7509ab095` | agent-memories #2 — fetch failure shows a false "no memories" | `stores/slices/overview/memorySlice.ts`, `overview/sub_memories/components/MemoriesPage.tsx` |

## What was fixed

1. **recipes #1** — `RecipeManager` tracked `loading` but never passed it to `RecipeList`, which branched only on `recipes.length===0`, so a populated library flashed the first-run empty state during the fetch. Threaded `loading` through and render the already-imported `RecipePageFlipLoader` while `loading && recipes.length===0`; only fall through to `EmptyState` once loading is done.
2. **test-suites #1** — `LabVersionsTable` fired three fetches in an effect but tracked no in-flight flag, so `UnifiedTable` showed its "no versions measured" empty branch until data landed (a transient "no data" that reads as data loss). Added a `loading` flag (set true before the fetches, cleared in a `Promise.all().finally()` over the two async ones; `loadBaseline` is sync) and passed `isLoading={loading && rows.length===0}` to `UnifiedTable`'s existing loading row.
3. **agent-memories #2** — a rejected `fetchMemories` only fired a transient toast and left the list on "No memories yet" — identical to a genuinely empty DB, with no recovery. Added `memoriesError` to the slice (set in the catch with the error message, cleared on start/success) and rendered an `AlertTriangle` + message + Retry card before the empty-state branch, mirroring `KnowledgeGraphDashboard`. Complements the `memoriesLoading` skeleton added in Wave 7.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | 0 errors (warnings only) |
| `cargo check` | n/a (no Rust this wave) |

## Remaining missing-state highs (~14, not blocked — just not yet done)

Each needs its hook/caller threaded (an `error`/`loading` field surfaced from a hook, or a flag wired from a parent), so they're follow-on work rather than one-line branches:
- **creative #2** — Artist gallery has no error state; needs `error` surfaced from `useArtistAssets` then an error branch in `GalleryPage` (mirror Drive's `error_prefix`).
- **credential-vault #4** — `PickerGrid` has no loading state; needs a `loading` prop threaded from the connector-definitions resolver + a skeleton grid.
- **settings/byom #3** — `EngineSettings` has no error state and the BYOM bulk key-load `.catch(() => ({}))` swallows failures into an empty map; capture the error in state + reuse `ApiKeysSettings`' error banner.
- **lab #1** — the scenario matrix renders running/partial/errored cells identically to a low score; needs per-cell `r.status` branching (`Loader2`/`AlertTriangle`/score).
- **deployment #3, evolution #1, onboarding #2, research-lab #6, test-suites #2, credential-recipes #1, persona-chat #2, triggers #2, companion #2, cloud-sync #2** — see the per-context reports; each is a loading/error/verdict branch on its own surface.

## Patterns reinforced (catalogue, continued)

48. **Thread the flag that already exists before adding one.** `RecipeManager` already had `loading`; the fix was passing it down, not new state. Check the parent/slice for an existing in-flight or error flag first.
49. **Await the async ones, ignore the sync ones.** When an effect fires several store actions, only the ones typed `Promise<void>` gate loading — `Promise.all([...async]).finally()`; a sync action (`loadBaseline`) runs alongside. `Promise.all` over `void` returns resolves immediately and would defeat the flag, so confirm the signatures.
50. **An error field is a slice concern, a retry is a page concern.** Add `xError: string|null` to the slice (set in catch, clear on start/success); render the error+retry branch in the component, gated before the empty state. Reuse a sibling's error-card markup so surfaces fail identically.

## Cumulative status

| Tier | Waves | Theme | Closed |
|---|---|---|---|
| 1 | 1–6 | Reliability criticals | 33/41 C |
| 2 | 7–9 | UI criticals | 16/19 C |
| 3 | 10 | Color-only status | 5/6 H |
| 3 | 11 | Programmatic labeling | 6/6 H |
| 3 | 12 | Duplicated markup (low-risk subset) | 3/14 H |
| 3 | 13 | Error-blind / missing-state | 3/17 H |
| | | **Criticals fixed** | **49** |
| | | **Highs fixed (Tier-3)** | **17** |

Tier-3 remaining: ~152 highs. Still-open themes: ~14 more missing-state, keyboard-reachability a11y (~5), 11 component-extractions (deferred), hardcoded-i18n (~10), token/contrast drift (~15), plus visual-hierarchy/consistency highs.
