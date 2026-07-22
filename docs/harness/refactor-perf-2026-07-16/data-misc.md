# data (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 0 medium / 2 low)
> Context group: Core Libraries & State | Files read: 1 | Missing: 0

## 1. `getActiveRelease` / `getReleaseByVersion` / `releasesConfig` are dead exports
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/data/releases.ts:78
- **Scenario**: A repo-wide grep (src, tests, scripts, docs) shows no importer of `getActiveRelease`, `getReleaseByVersion`, or `releasesConfig` — the only consumers of this module (`HomeReleases.tsx`, `roadmapItems.ts`) import `getNavReleases`, the two META maps, and the types. `getActiveRelease` is never called anywhere; `getReleaseByVersion` is called only by `getActiveRelease`; `releasesConfig` is used only inside this file.
- **Root cause**: The "active release opens by default" selector was written for a UI flow that `HomeReleases` no longer uses (it derives everything from `getNavReleases()`), and the exports were never pruned.
- **Impact**: ~35 lines of unreachable code plus a stale doc contract ("Falls back to the first non-roadmap release…") that misleads readers about how the active release is actually surfaced (it is only the sort-first rule inside `getNavReleases`). No runtime cost, pure maintenance noise.
- **Fix sketch**: Delete `getActiveRelease` and `getReleaseByVersion`, and drop the `export` on `releasesConfig` (keep it module-private). If the "active version must exist in releases[]" invariant is worth keeping, move it into a small assertion or a unit test on `getNavReleases`. Verification: exports are file-local per grep; no dynamic-import indirection exists for this module.

## 2. `RELEASE_TYPE_META` and `RELEASE_STATUS_META` repeat identical badge-token triplets
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/data/releases.ts:153
- **Scenario**: The cyan (`feature` / `active`), emerald (`fix` / `released`), and neutral-secondary (`chore` / `roadmap`) `{badgeBg, badgeText, badgeBorder}` triplets are written out twice, character-for-character, across the two maps. Anyone retuning the badge palette must edit two places and can drift them apart.
- **Root cause**: Both maps were hand-expanded instead of composing from a small set of named color-token presets.
- **Impact**: Bounded (10 entries total) but this is exactly the token-drift pattern the project's design-system moonshots keep flagging; drift here shows up as visually mismatched badges on the What's New page.
- **Fix sketch**: Define `const BADGE = { cyan: {...}, emerald: {...}, red: {...}, blue: {...}, orange: {...}, purple: {...}, neutral: {...} } as const` once, then build both maps by reference (`feature: BADGE.cyan`, `active: BADGE.cyan`, …). Same public shape, zero call-site changes.
