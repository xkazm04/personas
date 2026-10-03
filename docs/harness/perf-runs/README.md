# perf-nav-walk runs — and which of them are evidence

Written by `tests/playwright/perf-nav-walk.spec.ts`. One file per run, named by
its ISO timestamp. The files are **historical records and are never rewritten**;
corrections go here.

> **This directory is gitignored** (`.gitignore:245`, from the 2026-09-05
> archival pass that also listed `perf-runs` in `docs/harness/ARCHIVED-RUNS.md`).
> `git ls-files docs/harness/perf-runs/` returns nothing: **no run JSON in here
> has ever been tracked**, and the runs below exist only in the working tree of
> whichever machine produced them. `tests/playwright/perf/README.md` still says
> "The JSON files are tracked in git, so PRs … can show before/after numbers" —
> that is not true and has not been since 2026-09-05. This README is
> force-added so the warnings below survive beside the data; the data itself
> stays untracked.

## Schema versions

| `meta.schemaVersion` | Runs | What it can and cannot tell you |
|---|---|---|
| absent (= 1) | `2026-09-24T10-08-09-822Z.json`, `2026-09-24T10-16-41-960Z.json` | A failed stop **silently carries another stop's snapshot**; a stop that never settled is indistinguishable from one that settled instantly; a mid-walk page reload is invisible. See below. |
| 2 | later runs | Carries `status`, `settle.settled`, `timing.harnessMs`, `perf.pageLoad.id` / `resetSeq`, `firstOnPageLoad`, `ipcSplit`, and a `summary` block. |

## `2026-09-24T10-08-09-822Z.json` — 6 of its 30 rows are NOT measurements

**Do not use this run to rank surfaces.** Verified 2026-10-03 by re-reading the
file; the data is left untouched on purpose.

**1. Six rows are byte-identical copies of the pre-walk probe snapshot.**
`settings/engine`, `twin/hub`, `revisit/credentials-2nd`, `revisit/overview-2nd`,
`revisit/settings-2nd`, `interaction/live-events-burst`. All six carry
`resetAt = 7234.099999904633`, `snapshotAt = 10606`, `durationMs = 3371.9`,
`ipc.totalCount = 26` — the snapshot the spec took *before the walk started*, as
a placeholder it then failed to replace. All six also carry a `setupError`
(two `504 Bridge response timeout (15s)`, four `fetch failed`), which is the only
hint in the file that they are not real. No successful row in the run shares that
payload, so the six are mutually identical and otherwise unique. Root cause: the
placeholder `perf` was assigned outside the `try` block
(`perf-nav-walk.spec.ts:236` as of that run). Fixed 2026-10-03 — a failed stop
now records `status: "failed"` and `perf: null`.

**2. The bridge was dying from `settings/engine` onward.** The two 504s and then
four straight `fetch failed` mean the test-automation server stopped answering.
Rows 18–24 (`settings/byom` … `twin/setup`) were measured *between* those
failures and are suspect as a class, not just individually.

**3. The webview reloaded at least twice mid-run, re-basing `performance.now()`.**
`resetAt` is page-relative, so it goes backwards at each boundary:
`plugins/dev-tools` resets at 7,598.1 after `plugins/browse` snapshotted at
21,833.9; `twin/profiles` resets at 11,679.9 after `settings/config` snapshotted
at 42,239.9. The first stop on a fresh timeline absorbs the app's whole
bootstrap.

**4. The two "worst surfaces" in this run do not exist.**
- `twin/profiles` was recorded at `durationMs = 10,264.5` with 54 IPCs. It is a
  post-reload stop: its 54 calls are `companion_init`, `radio_*`, `fleet_set_*`,
  `delete_stale_seed_templates`, `batch_import_design_reviews`,
  `obsidian_brain_get_config` and friends — the app booting. Its own 4 IPC calls
  total 88.9 ms. ~7.3 s of the duration was the spec's settle loop sitting at its
  8 s ceiling, which the old `waitForIdle` returned from silently. In the clean
  run below the same stop is **1,189.2 ms with 1 IPC**.
- `plugins/dev-tools` was recorded at 2,533 ms and read as the next worst
  surface. It is the other post-reload stop. In the clean run it is **839.4 ms
  with *more* IPC (23)**. The 4x gap between these two was a comparison between
  two artefacts.

## `2026-09-24T10-16-41-960Z.json` — clean, and still schema 1

All 30 stops succeeded, `resetAt` is monotonic across the whole walk (no reload),
and no row duplicates another. It is usable. What it still cannot tell you:

- whether any stop hit the settle ceiling. Every zero-IPC stop lands in
  739–767 ms, which is the loop's floor (100 ms initial delay + ~600 ms stability
  window + polling), so those rows measure the harness, not the surface.
- which IPC calls were ambient. Two wall-clock polls land in whichever window is
  open and are **deliberate product behaviour, not defects**:
  `get_system_metrics` every ~2 s (`src/features/shared/chrome/SystemLoadFooterIcon.tsx:19`)
  and `list_team_channel` ~8x/60 s (`src/features/fleet/monitor/grid/rail/useRailFeeds.ts:34`).
  They are 17 and 20 of this run's calls respectively. Schema 2 splits them out
  per row as `ipcSplit.ambientCount`.

## `2026-10-03T01-03-04-081Z.json` — schema-2 proof, NOT a clean baseline

The first run written by the fixed harness. It exists to show that the three new
fields work against a real app, and it should not be used as a performance
baseline: it was taken against a **dev build with HMR, on a working tree being
edited concurrently by four sessions**, so the absolute numbers measure that
situation and not a release build.

What it proves, with its own numbers:

- `summary` reports `measured: 30, failed: 0, unsettled: [], pageLoads: 1`, and
  `firstOnPageLoad: ["L1/home"]` — the first stop had `perf.pageLoad.resetSeq === 1`
  and is correctly flagged as having absorbed whatever the app had already done.
- `resetAt` is monotonic across all 30 stops and every row carries the same
  `pageLoad.id`, so the clock never re-based. That is now a *checkable* claim.
- **`durationMs` is 99.8% harness.** Summed over the run, `perf.durationMs` is
  37,554.7 ms and `timing.harnessMs` is 37,492 ms; the per-stop residual is
  0.8–4.3 ms (median 2 ms). `L1/home` reads `durationMs: 800.2` against
  `harnessMs: 798`. Anyone ranking surfaces by `durationMs` is ranking the
  settle loop.
- **43% of the run's IPC was ambient.** 99 calls total: 56 own, 43 from the two
  wall-clock polls. `L1/design-reviews` recorded 14 calls, **all 14 ambient** —
  under schema 1 that row would have read as a chatty surface.

## Reading any run

`perf.durationMs` is the length of the measurement **window**, not the cost of
the surface. It contains the spec's own setup and its settle loop. The costs that
belong to the app are `perf.ipc.totalDurationMs`,
`perf.render.totalActualDurationMs` and `perf.longTasks`. On schema 2, subtract
`timing.harnessMs`; on schema 1 you cannot, which is why these two runs needed
this file.
