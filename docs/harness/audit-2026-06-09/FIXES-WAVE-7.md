# Audit Fix Wave 7 — Error-blind UI surfaces (Tier-2 begins)

> 6 commits, 6 of 7 critical UI findings closed; 1 deferred (6-panel + slice change).
> Theme: surfaces that render a fetch error / loading state as a misleading "empty" — so the user can't tell "nothing here" from "it broke" or "still loading".
> Baseline preserved: `tsc --noEmit` 0; eslint clean (the only new warnings are intentional inline error strings — i18n keys are a shared-WIP trap per harness-learnings).
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `e3a4542f1` | reviews #3 — page drops `isLoading`, flashes "0" | `templates/components/DesignReviewsPage.tsx` |
| `1e4343705` | persona-authoring #1 — name has no validation | `sub_settings/components/PersonaSettingsTab.tsx`, `sub_editor/libs/useEditorSave.ts` |
| `13a43a70e` | dev-scanner #1 — failed scan renders nothing | `dev-tools/sub_scanner/IdeaScannerPage.tsx` |
| `b…/4` (`<cockpit>`) | onboarding #1 — cockpit error → "empty" CTA | `home/sub_cockpit/CockpitPanel.tsx` |
| `<memories>` | agent-memories #1 — empty flashes during load | `overview/memorySlice.ts`, `sub_memories/.../MemoriesPage.tsx` |
| `cda47b2ac` | executions #1 — failed fetch → "no runs yet" | `agents/executionSlice.ts`, `useExecutionList.ts`, `ExecutionList.tsx` |

## What was fixed

1. **reviews #3** — `DesignReviewsPage` dropped the `isLoading` the hook exposes, so the subtitle rendered `reviews.length` (0) during the fetch then snapped to the real count. Now shows a neutral `…` while loading with no data.
2. **persona-authoring #1** — the required name input had no validation/error affordance and autosave persisted an empty name (nameless personas). Now shows an error state (`inputFieldClass` + `aria-invalid`/`aria-describedby` + "Name is required") and `performSettingsSave` skips while the name is empty.
3. **dev-scanner #1** — a failed scan set `scanPhase:'error'` but the JSX only branched on running/`ideas.length`, so it fell back to the generic "no results yet" placeholder. Added an inline error panel (`AlertCircle` + text) on the error phase.
4. **onboarding #1** — a rejected cockpit fetch left `spec=null`, collapsing into the "your cockpit is empty" CTA. Added an explicit error state + Retry before the empty branch.
5. **agent-memories #1** — the memories list read no loading flag, flashing "No memories yet" on every load/filter. Added `memoriesLoading` to the slice + a skeleton branch gating the empty state.
6. **executions #1** — a failed executions fetch left `executions=[]`, rendering the "Agent ready" empty state. Added `executionsError` to the slice → `useExecutionList` → an error card + Retry before the empty state.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | clean (only intentional inline-string warnings) |
| `cargo check` | n/a (no Rust this wave) |

## Deferred (1 of 7)

- **research-lab #1 — every pipeline stage is error-blind.** All 6 stage panels (literature/hypotheses/experiments/findings/reports + the runs drawer) track only `*Loading` and swallow errors, so a failed fetch renders the inviting "empty" state across the whole pipeline. The clean fix adds an `error` field to `researchLabSlice` (per stage or shared) and an error+retry branch to each of the 6 panels — a repetitive 6-surface change best done in one focused pass. Deferred.

## Patterns reinforced (catalogue, continued)

26. **Three states, not two.** A fetched surface needs `loading` / `error` / `empty(success)` branches — collapsing `error`→`empty` or `loading`→`empty` is error-blind. Add the missing branch + a retry; only show "empty" on a genuine zero-row success.
27. **Validate required inputs at the edge AND gate the write.** A required field needs both a visible error affordance and a save-path guard (skip the write while invalid) so an invalid value can't silently persist.

## Cumulative status

| Tier | Wave | Theme | Closed |
|---|---|---|---|
| 1 | 1 | Lost-update writes | 8/8 |
| 1 | 2 | Transition guards & lock leaks | 5/7 |
| 1 | 3 | Success theater | 4/7 |
| 1 | 4 | Orphaned processes | 5/5 |
| 1 | 5 | Security | 6/7 |
| 1 | 6 | Corruption loops & integrity | 5/7 |
| 2 | 7 | Error-blind UI surfaces | 6/7 |
| | | **Total criticals fixed** | **39** |

Remaining: Tier-2 Wave 8 (critical a11y, 6) + Wave 9 (destructive-confirm + broken UI, 6); the 9 deferred items (8 Tier-1 + research-lab #1); and the 169 Tier-3 highs.
