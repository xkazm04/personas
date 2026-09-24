# Style mastery instruments

Two instruments judge every module gate in the style-unification campaign. Both write to `tmp/`
(gitignored). Re-run them at each gate; never quote an old number.

## 1. Divergence: which module to fix, and did it move

`npm run style:divergence` (`scripts/style/style-divergence.mjs`) ranks `src/features` modules by raw
style usage versus tokens per 100 LOC. A gate reads the module's score before and after the change.

## 2. Page shots: what the operator judges

`scripts/style/shoot.mjs` renders one module's real page component inside the app shell's geometry
(48px titlebar, 88+240px sidebar columns, the `#main-content` column of `PersonasPage`) in headless
Chromium, through the repo's own Vite config, on IPC data replayed from a tape. Same tape in, same
pixels out: two runs of unchanged code are byte-identical, so a pixel delta means the code changed.

It does not screenshot the running app: `scripts/capture-canvas.mjs` records four OS-level
approaches that returned plausible wrong images.

```bash
# BEFORE (keep the dir: it holds tape.json, the exact data used)
npm run style:shoot -- --module home/sub_releases --tape synthetic --out tmp/style-shots/m1-before --label before
# AFTER, on the same data
npm run style:shoot -- --module home/sub_releases --tape tmp/style-shots/m1-before/tape.json --out tmp/style-shots/m1-after --label after
# One side-by-side image per view, with a changed-pixel count in the label strip and pair-report.json
npm run style:shoot -- --pair tmp/style-shots/m1-before tmp/style-shots/m1-after --out tmp/style-shots/m1-pair
```

Each shoot writes `<label>-<W>x<H>-<theme>.png` for 1280x800 and 1920x1080 in `dark-midnight` and
`light` (the default light theme), plus `<label>-report.json`: console errors, IPC commands missing
from the tape, args mismatches, text length, page dimensions, and the browser build.

- **Exit 1** on any console error, harness or render error, or an empty mount (fewer than 40 characters
  of text in `#main-content`). `node scripts/style/shoot.mjs --self-test` proves both failure paths still
  fire. A blank screenshot never looks like a result.
- The clock is frozen at the tape's `recordedAt` and the timezone is UTC, so relative times and
  Today/Yesterday grouping are stable. The first render of a run is discarded (it differed by a few
  anti-aliased pixels), and each shot waits until two consecutive frames match.
- Light shots use the store's default brightness, which for light themes is `low`, a 0.82 filter the
  settings call "Dimmer". Pass `--brightness high` for an unfiltered light theme.
- The browser is Playwright's pinned headless shell, or the newest one in the ms-playwright cache.
  `--pair` refuses shots taken with different builds (`--allow-browser-drift` overrides).
- Options: `--sizes`, `--themes`, `--settle <ms>`, `--tz`, `--strict-ipc`, `--serve` (keep the harness up
  on :1432 for a browser). Each run uses its own Vite dep cache, so it never disturbs the dev server.

### Tapes

A tape is `{ version, module, source, recordedAt, note, calls: [{ cmd, args?, response | error }] }`.
Replay (`page-harness/tapePlayer.ts`, via Tauri's `mockIPC`) answers with the last call whose args
match, then a call without `args` (wildcard), then the command's last call. A command absent from the
tape is answered with `[]`, `0` or `null`, logged, and listed in the report; if the page then throws,
the console error fails the shot.

- **Synthetic** (`--tape synthetic`): fixture code in `page-harness/synthetic-tapes.mjs`, built from the
  bindings' shapes. `home/sub_releases` replays the published `personas-web/public/roadmap/v1.json`.
- **Recorded**: start the app with `npm run tauri:dev:test`, keep its window visible (the bridge drops
  eval'd JS in an occluded webview, and the Rust side then pulls the window to the foreground), then
  `node scripts/style/page-harness/record-tape.mjs --module <id>` (`--manual` to navigate by hand).
  It turns on the tap in `invokeWithTimeout` (`src/test/automation/ipcTape.ts`, reachable only through
  the test bridge), runs the module's route steps, and writes `tmp/style-tapes/<module>.json`. Raw
  `invoke` calls are not tapped. Boot commands from `modules.json` are added by the script, and
  `fill` answers what a session does not reach (for events: loading older pages).
- Recorded tapes carry personal data. They live under `tmp/` only; never commit one.

### Adding a module

1. `page-harness/registry.tsx`: lazy page import, providers, and `prepare` (route state, boot preloads).
2. `page-harness/modules.json`: record steps (bridge `navigate` / `clickTestId`), boot commands, fill.
3. Record a tape, or add a synthetic builder. Shoot, read the report, open the PNGs.

Registered: `overview/sub_events` (calibration) and `home/sub_releases` (module 1).

## What each gate uses

| Gate step | Instrument |
|---|---|
| Pick the module, confirm the score dropped | divergence |
| Operator verdict | `--pair` images from BEFORE/AFTER shots on one tape |
| Did anything break | shoot exit code and report (console errors, empty mount, unknown IPC) |
