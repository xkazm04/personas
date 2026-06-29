# Combined-Scan Fix Wave 12 — FE metric / lifecycle

> 6 atomic fix-commits, 6 findings closed (all High) — no deferrals. All frontend.
> Baseline preserved: **tsc 0; vitest 1988 pass / 7 pre-existing fail (+9 new test cases, no regressions)**.

## Commits

| # | Commit | Finding |
|---|---|---|
| 1 | `4dba60cdc` | dashboard #2 (UpcomingRoutines no-refetch) |
| 2 | `54bec6a7c` | dashboard #3 (success-rate counts healing) |
| 3 | `4156f89aa` | home #2 (success-rate denominator) |
| 4 | `02ed96fca` | observability #1 (alert-history-50 cap) |
| 5 | `4e5b9be24` | onboarding #1 (stale step timeouts) |
| 6 | `e1e08bfbd` | persona-editor #1 (icon-gate v1/v2) |

## What was fixed

1. **Upcoming-routines card empties over a session.** Fetched once on mount; only the 30 s tick re-filtered the stale list, so past-due rows were dropped and never rolled forward → EmptyState while routines were still scheduled. Now refetches on the same 30 s/visibility cadence (guarded against overlap).
2. **Persona flagged "Low Success" off resolved healing.** `failedEstimate` summed lifetime healing issues regardless of status. Now uses `healing.open` only — a persona with only resolved/auto-fixed issues isn't flagged; real open failures still are.
3. **Home success rate over a mixed denominator.** `successful/total` counted running/cancelled rows, painting a calm green low rate and masking a real failure spike. Now `completed/(completed+failed)` (neutral "—" when zero terminal); spike on the same denominator.
4. **Alert history hid past-50.** `slice(0,50)` inside an already-scrollable container hid (and made un-dismissable) undismissed alerts at index 51+ while the badge counted all 200. Removed the slice.
5. **Onboarding stale side effects.** Pending step timeouts (open builder, switch tab, move spotlight) were only cleared on tour-end, so a fast Next/Skip let the abandoned step's effects fire. Now cleared on every step change + an in-callback index guard.
6. **Per-load store revert.** A `v1`/`v2` icon-gate key mismatch made `fetchPersonas` run `listPersonas() + set()` on every load, which could revert a decrypted `model_profile` (dropping the BYOM token) to a redacted row. The helper now returns whether it assigned icons; the re-fetch runs only then.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `vitest run` | 1988 pass / 7 pre-existing fail (+9 new, no regressions) |

## Pattern catalogue (items 36–37)

36. **Glanceable card with a one-shot fetch + a clock that can only remove rows** — the card empties as time passes because nothing re-pulls the source. Refetch on the tick (or invalidate on the relevant event), don't just re-filter.
37. **Rate over a mixed-status denominator** — dividing successes by COUNT(*) (incl. in-flight) understates the rate and dilutes a failure spike. Define the rate over terminal states only and return a neutral no-data value at zero.

## Cumulative status (Waves 1–12)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–11 | security → migrations/data-integrity | 62 (6C/56H, 2C mitigated) |
| 12 | FE metric / lifecycle | 6 (6H) |

**Total: 68 findings addressed across ~83 commits, 0 regressions.** 6/6 scan Criticals fixed-or-mitigated; **62 of 81 Highs closed.**
**Remaining: ~19 High** — backend orchestration (build-sessions persist-unvalidated + simulate-clobber, genome fitness-theater, incidents resume-swallow, team-assignment lost-resume, self-healing rollback-floor) and a plugin/FE tail (artist ×2, google-drive ×2, design-reviews crash, capabilities budget, i18n RTL, persona-templates questionnaire, personas-twin, recipes threshold, state-mgmt selector, tauri-ipc ×2). Next: Wave 13 — backend orchestration.
