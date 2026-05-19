# Smoke run findings (3 templates, all hard-failed)

Recorded 2026-05-19 ~22:25 local. Smoke run intent: validate the marathon
harness with `--target 3 --continue-on-fail`. Result: 0 / 3 passed,
3 distinct failure shapes that point to gaps in the spec (not the
driver).

## Per-template outcomes

| Template | Phase | Signature | Diagnosis |
|---|---|---|---|
| `autonomous-art-director` | open | `POST /navigate → 504: Bridge response timeout (15s)` | Bridge wasn't ready ~60 s after `tauri:dev:test` warm-restart. `tti_ms=61201` in the app log confirms a 61-second time-to-interactive on this start. |
| `demo-recorder` | open | Same 504 timeout on `/navigate` | Same root cause — bridge still not responsive when test #2 launched immediately after #1. |
| `scientific-writing-editor` | open | `clickByText: "Adopt" not found in 10000ms` | Bridge is now responsive but the spec's "find Adopt button" assumes the button is visible. The template gallery (under `templateTab=generated`) shows collapsed rows; the Adopt button only appears after the row is clicked to expand. My spec navigates and immediately searches for "Adopt" — the row was still collapsed. |

## Verified after the run

- `curl POST /navigate {"section":"design-reviews"}` returns
  `{"success":true,"section":"design-reviews"}` in < 100ms. The bridge IS
  responsive — the 15s timeouts on tests #1 and #2 were warm-up artefacts.
- `bridge-exec getState` returns correct UI state: `sidebarSection:
  "design-reviews"`, `personaCount: 3` (pre-existing personas, none
  created by the marathon).

## Three structural fixes needed in the spec

1. **Cold-start bridge warm-up.** Before phase 1, ping `getState()`
   via `/bridge-exec` and retry up to 60s. Discard the first run's
   navigate timeout as expected.
2. **Wrong template tab.** Spec calls `template-tab-recipes`. The
   correct destination is `templateTab === 'generated'`, set via
   `useSystemStore.getState().setTemplateTab('generated')` — there's
   no testid; need a bridge helper or direct invokeCommand.
3. **Row expansion before Adopt.** Templates render as collapsed rows
   in `GeneratedReviewsTab`'s gallery. Clicking the row toggles
   expansion; Adopt button is in the expanded body. Spec needs a
   click-then-wait-for-expanded-state step.

## Beyond the spec — strategic options

The user's overnight ask was "drive Glyph variant adoption end-to-end for
50 templates." The smoke proves the harness *plumbing* works (driver
loop, result JSON write, signature matching, retry, pause) but the
*UI-driving spec* has multiple discovery gaps that surfaced on first
run. Each fix is small individually; iterating all of them before the
marathon is reliable will cost several CC sessions of UI inspection.

Three forward paths, by cost/value:

- **(A) Harden the UI spec.** ~2–4 more iteration cycles to fix the
  three gaps above + the ones that will surface on phases 2–7. Costs
  CC sessions; delivers the user's exact ask.

- **(B) Pivot to HTTP `/adopt-template` for the build leg.** Existing
  `tools/test-mcp/e2e_30_adoption.py` already does this; skipping the
  UI driving for adoption brings marathon time-to-greenfield down
  10×. Trade: skips the Glyph variant validation the user explicitly
  asked for. The marathon then validates everything *after* the
  modal but not the modal itself.

- **(C) Hybrid.** Drive UI for the open-template + variant-switch
  steps (1 minute per template) → use HTTP for build + promote → UI
  for capability execution + verification. Validates the Glyph
  variant rendering without spending all night iterating on the
  questionnaire driver.

Recommendation: **C**. Most honest balance of "exercise the new code"
vs "don't burn the budget on selector archaeology."

## State right now

- App is running on :17320 (warm).
- `tests/results/marathon/*.json` has 3 hard-fail entries.
- `tests/results/marathon-state.json` records the attempts.
- No personas were created by the smoke; user's DB unchanged.
- Driver paused; ready for `--resume` once spec is hardened or
  re-scoped.
