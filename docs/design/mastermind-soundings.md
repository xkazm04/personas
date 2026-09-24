# Mastermind Soundings: migrating the contest winner into Personas

Status: phase 1 in progress (2026-09-24). Owner decision: **Soundings** won the Mastermind
next-gen contest (round 1 shortlisted Vitrine and Soundings, round 2 reworked both onto the
Personas themes, and the owner picked Soundings). It ships as a second view beside the shipped
**Baseline** (Hex Mosaic) until it is fine-tuned; the three.js prototypes (**Strata**, **Holo**, the
dev-only design **Board**) are deleted in the same change.

Why the 3D line ends: "The three.js approach capped us into what we can do with design quality."
Text in WebGL is either blurry or a DOM label floating in front of a scene it does not belong to,
and every label was its own React root, so density had to be cut instead of designed.

Source of the design: `.contest/arena/mastermind-nextgen-r2/entries/claude-claude-opus-5-5_xhigh-v2/variant-2/`
(gitignored, one static HTML file plus `NOTES.md`). The contest records live in
`.contest/Contest/contests/mastermind-nextgen.md`.

## What Soundings is

A nautical sounding chart where **depth means urgency, not hierarchy**. Ten projects are stations
at fixed horizontal positions that never move; each station's buoy floats at a height set by one
published formula, so the projects that need the owner break the surface. Floats on the waterline
say why (an alert count, a late release, an agent waiting for input). Inside a station the same
rule holds at the level below: its fifteen readings sit in four category lanes, and a reading
lives in the band its status puts it in (Surface needs you, Shallows is not built, Mid-water is in
progress, Deep is done). Relations run as currents along the seabed.

Three levels, each its own reading:

| Level | What it shows | Enter / Esc |
|---|---|---|
| L0 chart | every project as a buoy at its urgency depth, reasons on the waterline, relations on the seabed | Enter opens the focused station |
| L1 station | the station widens into a water column; the other projects shrink to slivers that keep their order and a status tick; readings as frames in 4 lanes x 4 bands; a strip with live work, next ship, spend, errors, blockers | Enter lifts the focused reading, Esc returns to the chart |
| L2 sample | one reading rises into a card: tooling, progress ladder, depth, the real Improve action, and the same reading across the whole portfolio at the portfolio positions. `I` opens the project file instead: sessions, personas, release plan, readiness, relations | Esc sinks it back |

**The urgency formula** (kept verbatim from the prototype, so the chart means what the owner
reviewed): `3 x alerts + risks + 2 if the release is late + 2 if an agent waits for input +
3 if critical / 1 if warning`, plus `1 if no monitoring is bound` and `0.25 per gap` (absent or
unknown). Bands: `u >= 6` Surface, `>= 2` Shallows, `>= 1` Mid-water, else Deep.

## Mapping the prototype onto live data

The prototype read the contest fixture (`mockWorld`). Soundings in the app reads the same
`canvasScene` the Baseline renders, so hidden projects stay hidden and a live fleet tick moves a buoy.

| Prototype field | Live source | Note |
|---|---|---|
| `project.dims[]` | `Island.nodes[]` (`DimNode`) | status, reached/steps, detail, action are all there |
| `dim.figure` | `DimNode.days` for Ideas / Goals payloads, else none | the passport has no per-dimension headline number; the frame's second line shows the tool (`detail`) instead |
| `project.tag` (`PRS-01`) | **dropped** | real projects have no tag; slivers show the name vertically and the comparison strip shows the name |
| `fleet[]` | `Island.fleet` (`FleetNode`: id, label, state) | `awaiting_input` drives the lilac flag |
| `personasRunning` | `Island.personasRunning` | |
| `ship` | `Island.ship` (`IslandShip`) | `late`, `targetDate`, `shipped/total`, `next` |
| `llmSpend30d` | `Island.stats` entry `llm` (already formatted) | honest `-` when unwired |
| `monitorErrors` | `Island.monitorErrors` | `null` = not bound, counts toward urgency |
| edges | `Scene.edges` (`IslandEdge`, label may be null) | similarity drawn dashed |
| provisional islands | `Island.provisional` | drawn as calm ghosts, excluded from the ranking until measured |
| station order | project name, locale compare | stable across sessions, the prototype's "position never moves" |

**Actions are real, not demos.** The L2 Improve button calls the page's `onDimOpen` (the same
popovers the Baseline cell opens). The project file's sessions open the Fleet preview, personas
open the persona list, the next ship opens the notepad, and the file offers Open in Factory,
Dispatch fleet and Open terminal through the page's existing handlers.

**Athena operates through the real grammar.** The prototype's four scripted commands and its
revert key were demos over a mock world; they are not ported. Instead Soundings answers the same
`canvasActionStore` queue the Baseline answers: `camera.focus` opens a station, `camera.fit`
returns to the chart, `dim.open` lifts a reading and opens its Improve popover, `island.read` /
`dim.read` answer from the model. Each answered action pings the target with the sonar ring and
writes one line to the dock's log, so what Athena does is visible where she does it.

**Not ported:** the theme picker and the app-frame toggle (the app owns both), the `T` / `F` /
`U` keys, and the scripted Athena chips.

## Architecture

```
sub_mastermind/soundings/
  soundingsModel.ts      pure: islands + edges -> stations, metrics, rank, reasons, bands
  soundingsGeometry.ts   pure: chart geometry, station rects per level, buoy depth, column layout
  SoundingsView.tsx      the view: state (level, station, reading), keyboard, action queue
  SoundingsChart.tsx     L0/L1 surface: water, contours, stations, currents
  SoundingsColumn.tsx    L1 water column: the strip and the reading frames
  SoundingsCard.tsx      L2: the reading card and the project file
  StatusMark.tsx         the status mark: hue from --status-*, and a shape
  soundings.css          scoped under .sd-root; every colour derives from the theme tokens
```

- **Pure core, thin view.** Everything the prototype computed imperatively (metrics, ranking,
  reasons, band placement, the frame packing in `layoutColumn`, spatial arrow-key moves) becomes a
  pure function with unit tests. The view holds only `level`, the focused station, the focused
  reading, hover, and the measured chart size (a `ResizeObserver`).
- **Motion is CSS.** Elements stay mounted and keyed; positions are inline styles, and the
  prototype's transitions (station widening, buoy sinking, the plate rising from a frame to the
  card) come from the stylesheet. `prefers-reduced-motion` collapses them.
- **Keyboard through the app ladder.** `useAppKeyboard` at `ROUTE_DECISION_PRIORITY`, declining
  keys while an input has focus or an overlay is open. Arrows, Enter, Esc, `I`, `/`, `A` (next
  agent waiting), `R` (follow a relation), `H` (chart), `?` (help, a `BaseModal`).
- **Strings through `t.mastermind`.** Keys the 3D views already translated are reused where the
  meaning is the same (`dim_cat_*`, `world_fleet`, `world_next_ship`, `world_tooling`,
  `world_progress`, `world_llm_spend`, `fleet_*`, `legend_*`, `kb_state_*`, `jump_*`); new keys
  are `soundings_*`, in all 14 locales.
- **Page wiring.** `ViewSwitcher` becomes Baseline / Soundings. Soundings is lazy-loaded behind
  `RouteChunkSkeleton`; the Baseline-only chrome (mode toolbar, project list sidebar) hides while
  Soundings is up. The choice stays session-local until the owner makes it a preference.

## Deleting the 3D line

- `sub_mastermind/three/` (Strata, Holo, the Board, the shared world model, mock world, palettes,
  HUD) and its two tests (`worldModel.test.ts`, `designBoard.test.ts`).
- `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three` from `package.json` (no other
  importer in `src/`), the `vendor-three` manual chunk in `vite.config.ts`, and the
  `vendor-three` / `WorldCanvas` rows in `scripts/bundle-baseline.json`.
- The 54 i18n keys only the 3D views used, minus the ones Soundings reuses; the `mm3d-*` tour
  anchors regenerate with codegen.
- `docs/features/plugins/dev tools/mastermind.md` sections 7b and 7c are replaced by a Soundings
  section; `documentSurface.css` stops citing the Board stylesheet as its precedent.

## Phases

1. **This change.** Delete the 3D line; Soundings on live data with real actions, the action
   queue, keyboard, help, jump, i18n x14, unit tests for the pure core; the Baseline unchanged.
2. **Fine-tune with the owner (next).** Live smoke on the real portfolio; whether the urgency
   weights need tuning against real projects (the fixture's scale may not be the workspace's);
   persisting the view choice; whether the dock should carry Athena's composed panel.
3. **Retire the Baseline** only when the owner says Soundings replaces it.

## Owed

- Live smoke in the running app (the owner's portfolio, not the fixture).
- Tuning the urgency weights against real data: the prototype was calibrated on ten fixture
  projects, and a workspace where most projects lack monitoring will sit lower in the water.
