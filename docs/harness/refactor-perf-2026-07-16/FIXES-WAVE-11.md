# Refactor+Perf Fix Wave 11 (F2) — Render/compute churn tail

> 5 commits, 10 findings closed. **Theme F is now fully closed (26/26).** Executed by a 5-agent parallel workflow (verify-before-fix); gates started only after the final edit (wave-10 lesson applied).
> Gates: tsc 0; vitest 2304/2304; eslint clean per-commit.

## Commits

| Commit | Findings | What |
|---|---|---|
| `e014777ca` | vault-credentials-2-4 #1, recipes-playground #2 | Infinite post-OAuth dispatch loop (fresh-per-render object dep) and per-progress-line stream teardown — both re-keyed on stable identities. |
| `d87f88ec4` | overview-memories #3, schedules-misc #2 | O(n²) conflict detection made linear (precomputed token/bigram sets, threshold-pruned Jaccard); calendar sweep windows chained so events aren't double-counted. Outputs preserved for flaggable pairs. |
| `13410334a` | recipes-misc #1, plugins-artist-1-2 #4 | Stable client-side row ids kill the per-keystroke remount/focus loss; beat-anchor patches batch into one present-only history write (undo stack intact). |
| `f0ca373f7` | hooks-utility-1-3 #1, lib-utils-1-2 #2, templates-generated-2-5 #1 | Debounce deps spread (was restarting every render); Intl.NumberFormat cached at module scope (was per-rAF-frame); design_result parsed once per review identity. |
| `054f0bc0e` | agents-lab-2-2 #1 | Virtualizer wired to a real scroll container (`data-virtual-scroll` opt-in) with normal-flow rows + spacer rows — layout survives virtualization. |

## Patterns established (catalogue items 30–31)

30. **Never pass an array/object built per render as a single effect dep** — spread caller deps into the effect list (with a targeted exhaustive-deps disable) or latch via ref.
31. **Derived-state writes that shouldn't be undoable need a dedicated present-only mutation path** — routing them through the normal history-tracked update floods the undo stack.

## Cumulative status (waves 1–11)

109 findings closed (1 Critical + 108 High) in 78 fix commits + 11 summaries across 11 waves. **Remaining C+H: theme I duplication (19) only**, plus 2 deferred schema items (migration stamp, memories content_norm) and the 926 Medium/Low backlog.
