# Bug Hunter Fix Wave 7 — Remaining criticals (batch 1: clean/localized)

> 5 criticals closed across 5 commits, 0 regressions.
> The clean, well-specified remainder: a render crash, success-theater feedback,
> a tour-completion lie, a copy-overwrite data loss, and a dead scheduled
> feature. (research-lab cross-project leak + the more involved remainder are
> deferred to wave 8.)
> Baseline preserved: `tsc --noEmit` 0 → 0, `cargo check --features desktop` 0 → 0.

## Commits

| # | Commit | Finding closed | File |
|---|---|---|---|
| 1 | `54d97dc30` | design-reviews-diagrams #1 — malformed flow crashes modal | `src/features/templates/sub_diagrams/FlowDiagram.tsx` |
| 2 | `80532dd6f` | fleet-control #1 — broadcast success-theater | `src/features/plugins/fleet/FleetBroadcastModal.tsx` |
| 3 | `2b80ad3c7` | onboarding-tour #1 — skip marks whole tour complete | `src/stores/slices/system/tourSlice.ts` |
| 4 | `5441d1531` | google-drive #1 — copy overwrites destination | `src-tauri/src/commands/drive.rs` |
| 5 | `491d23e05` | recipes-use-case-blueprints #1 — scheduled curation never fires | `src-tauri/src/engine/curation_scheduler.rs` |

## What was fixed

1. **Malformed flow crashes the diagram modal.** `FlowDiagram` dereferenced `flow.edges`/`flow.nodes` directly; an LLM flow omitting one threw "x is not iterable" inside a useMemo and blanked the modal (no ErrorBoundary). Now normalizes both to `[]` via memoized locals.
2. **Broadcast success-theater.** `handleSend` showed no toast on full success and an error-styled "delivered to 0 of N" on total failure. Now three explicit outcomes via `addToast`: success (green) / partial (amber) / none (red).
3. **Tour-completion lie.** `advanceTour` called `finishTour` (force-marks every step done + sets the badge) on running off the step list — so a "Skip" on the last incomplete step recorded the tour 100% complete. Now only force-completes when steps are genuinely all done; otherwise just closes.
4. **Copy overwrites destination.** `drive_copy` lacked the `dst.exists()` guard `drive_move` has, so a paste over a same-named file overwrote it irrecoverably. Added the guard (file + folder paths).
5. **Scheduled curation dead on arrival.** The scheduler parsed SQLite `datetime('now')` (space-separated) with an RFC3339-only `parse()`, always fell to `now`, and never enqueued a run. New `parse_db_timestamp` accepts both forms.

## Verification

| Gate | Baseline | After Wave 7 | Notes |
|---|---|---|---|
| `tsc --noEmit` | 0 | 0 | 3 frontend fixes. |
| `cargo check --features desktop` | 0 | 0 | 2 Rust fixes. |
| `vitest run` | 5 pre-existing | 5 (same) | Unchanged. |

No regressions introduced.

## Cumulative status (across all waves)

| Wave | Theme | Criticals | 
|---|---|---:|
| 1 | Concurrency / missing-CAS | 5 |
| 2 | Security & trust-boundary | 5 |
| 3 | Data-loss: watermark/cursor | 3 |
| 4 | Recovery/healing & runtime | 4 |
| 5 | Highest-blast-radius remaining | 5 |
| 6 | Next highest-blast-radius | 5 |
| 7 | Remaining criticals (batch 1) | 5 |

Criticals closed: **32 / 42**. Findings closed overall: **32 / 260**.

## Patterns established (catalogue additions, items 21–22)

21. **Guard untrusted LLM/external JSON at the point of use, not just one level deep.** A backend shape-check of only the top-level container, plus a TS type that *asserts* (but doesn't enforce) inner arrays, leaves a runtime gap — a missing inner field throws on deref and (without an ErrorBoundary) blanks the subtree. Normalize/validate at read, and wrap untrusted renders in an ErrorBoundary.
22. **Sibling commands that share a destination must share the same precondition.** `move` rejected an existing destination but `copy` didn't — the asymmetry made the "safe-looking" operation the destructive one. When two operations write the same target, audit them for the same guard (exists-check, disambiguation, trash-on-overwrite).

## What remains

10 criticals (wave 8 candidates): genome fitness-scale mismatch, mcp JSON-RPC id desync, connector stale-readiness, credential-design negotiator stub clobber, persona-templates checksum-dead, companion stale-session retry wrong-text, cockpit TTS overlap, research-lab cross-project store leak, personas-twin shared-slice overwrite, + the dedup-shared-slice tail. Plus the full High/Medium tail. All resumable from `INDEX.md`.
