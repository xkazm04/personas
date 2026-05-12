# Phase B2 — Health snapshot baseline (2026-05-12)

Captured before code-refactor scan dispatch. Used by Phase B7 regression check.

| Gate | Result |
|---|---:|
| `npx tsc --noEmit` (src/) | **0 errors** |
| `cargo check` (src-tauri/) | **0 errors** (142 warnings) |
| `npm run lint` | **0 errors** (12543 warnings — predominantly `custom/no-silent-catch`) |
| `npm test` | deferred — wave-time only |

**Note on warnings:** the 12.5k lint warnings are dominated by `custom/no-silent-catch` — they will not block dispatch but the code-refactor scan may surface them as a theme.

**Baseline invariant for Phase B7:**
- tsc must stay at 0 errors
- cargo check must stay at 0 errors
- lint error count must not increase (warnings may decrease as we close findings)
