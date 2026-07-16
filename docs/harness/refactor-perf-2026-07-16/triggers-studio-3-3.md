# triggers/studio [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 1 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 2 | Missing: 0

## 1. CLASS_ACCENT triad re-hardcoded in sibling files instead of reused
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_studio/routing/layouts/routing/accent.ts:8 (dupes at routing/ClassPillsBar.tsx:10-12 and routing/groupRows.ts:54-63)
- **Scenario**: `accent.ts` declares itself the single "source-class visual language" (USR/SYS/EXT triad), yet `ClassPillsBar.tsx` in the *same directory* hardcodes the identical label + `text-*/bg-*/border-*` class strings in its own `CLASS_PILLS` array, and `groupRows.ts` hardcodes the violet/amber USR/EXT accents a third time for synthetic panels. Anyone retuning the triad touches one file and silently misses the others.
- **Root cause**: `CLASS_ACCENT` was extracted for `EventRow.tsx` only; the pills bar and panel grouping were written against the same palette by copy rather than by import. Drift has already started: `CLASS_ACCENT` uses `border-*-500/30` while `groupRows` uses `border-*-500/25`.
- **Impact**: Real maintenance hazard for the visual code the accent.ts header explicitly promises stays consistent app-wide; three-way drift means a palette change produces mismatched pills vs rows vs panels with no compile error.
- **Fix sketch**: Have `CLASS_PILLS` derive from `CLASS_ACCENT`: `const CLASS_PILLS = (['persona','common','external'] as const).map(key => ({ key, label: CLASS_ACCENT[key].label, className: \`${CLASS_ACCENT[key].text} ${CLASS_ACCENT[key].bg} ${CLASS_ACCENT[key].border}\` }))` — the strings are statically present in accent.ts so Tailwind JIT still sees them. In `groupRows.ts`, build the USR/EXT panel accents from `CLASS_ACCENT.persona` / `CLASS_ACCENT.external` (deciding deliberately whether /25 or /30 border opacity is canonical).

## 2. studioLabels.ts claims to be shared but has one consumer, while its sibling resolver lives inline in StudioPatchbay
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/triggers/sub_studio/libs/studioLabels.ts:11 (sibling at StudioPatchbay.tsx:51)
- **Scenario**: `studioLabels.ts` says it exists "so the baseline switchboard and the deep-merge ledger variants resolve the same condition tokens identically", but repo-wide grep shows exactly one caller (`StudioPatchbay.tsx:169`). Meanwhile `StudioPatchbay.tsx:51` defines `chainCondLabel` — a second condition-label resolver over the same translation strings, but for the backend token domain (`success`/`failure` vs `on_success`/`on_failure`).
- **Root cause**: The two token vocabularies (draft-model `LinkCondition` vs live-chain backend tokens) each grew their own resolver; the "shared" module never gained its second consumer, and the newer resolver was parked in the component instead.
- **Impact**: Bounded: a future surface labeling chain conditions will likely re-invent the mapping or pick the wrong resolver, and the misleading "shared" doc-comment sends readers hunting for variants that do not exist.
- **Fix sketch**: Move `chainCondLabel` (and its `StudioStrings` alias) into `libs/studioLabels.ts` next to `conditionLabel`, exporting both from the one module the header advertises. Update the header comment to describe the two token domains so the next resolver lands there too.

## Perf lens

No perf-optimizer findings. Both files are a static `as const` object and a pure switch over four string cases — no allocation, iteration, rendering, or data-layer behavior to optimize.
