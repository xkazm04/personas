# Promotion plan: the fused Council HUD and the Cadastre Features page

Two contest winners are carried into the product as switchable variants beside the pages that ship today. Neither current page is touched beyond gaining a switch; the owner descopes the old variants once the new ones are polished. The method is the contest skill's `references/promotion.md` (port from measurement, never from memory); this file names what is measured, what is built, and in which order.

| Lane | Winner (arena, machine-local) | Product target | Switch |
|---|---|---|---|
| Council HUD | `.contest/arena/council-hud-r2-r3/entries/claude-opus_xhigh-v3/variant-3/` (fusion of round-2 Cross-section A/3 + Bezel B/2) | `src/features/companions/curator/council/` | `council-variant`: `classic` / `fused` |
| Features page | `.contest/arena/features-page-r2/entries/claude-opus_xhigh-v2/variant-2/` (The Cadastre, fused) | `src/features/teams/sub_features/` | `features-variant`: `board` / `cadastre` |

The owner's words that become the pass condition (promotion.md step 1) are quoted in `.contest/arena/features-page/OWNER-REVIEW.md`, `.contest/arena/council-hud/OWNER-REVIEW.md` and `.contest/arena/council-hud-r2/OWNER-REVIEW.md`.

## 0. Ground rules for both lanes

- **A variant is a sibling tree, not a rewrite.** `sub_features/cadastre/` and `council/galaxy/fused/` are new directories; the shipped trees keep their files. The switch is the `KpiVariantSwitcher` recipe (`src/features/teams/sub_kpis/kpiVariant.ts` + `KpiVariantSwitcher.tsx`): a persisted value read once, `SegmentedTabs` in the `ContentHeader` actions, the page body dispatching on it. Unknown persisted values fall back to the shipped variant.
- **Data comes from what the product already reads.** The Cadastre draws `FeatureBoard` (`getFeatureBoard`, one payload) through `buildFeaturesModel`; the fused HUD draws `GalaxyLayout` + the council overlay the classic galaxy already holds in `councilStore`. No new Tauri command, no migration. If a figure the winner draws has no wire field (say so per role in the contract), the port prints `not measured`, never a substitute.
- **Styling is ported in the form the winner expressed it** (promotion.md step 4): the winner's stylesheet becomes a scoped stylesheet under the variant directory, its custom properties re-pointed at the product's tokens (`globals.css :root`, `[data-theme^="light"]`), and the light-theme overrides the prototype never needed are added. Colours route through tokens so every theme repaints. No approximation with the nearest utility class.
- **Every component under 200 LOC** (owner rule), strings through `t.features.cadastre.*` / `t.council.fused.*` in all 14 locales, motion through `MOTION_PRESETS` with a `motion-reduce:` fallback, the app's type tokens with nothing under 13 px, no em dash in app text.
- **Gates per commit:** `npm run gate -- --cold`, `check:i18n:strict`, vitest for the touched trees, eslint on the touched directories; the warm gate is not trusted after Rust or CSS moves. Isolated-index commits with explicit paths; never push.
- **Verification is the instrument, not the gates** (promotion.md steps 2, 5, 6, 7, 8): a `roles.json` per lane, a contract captured from the winner, a harness served by the dev server with the product's real stylesheet and the contest's real data, `style-contract.py check` to **zero deviations** (structural mismatches fix the selector, never the tolerance), every owner-named interaction driven in a browser, side-by-side frames, and a final read through the live app's automation bridge (the app runs from the main checkout on 1420; the bridge is on 17320 when started with `tauri:dev:test`).

## 1. Features page: the Cadastre (`sub_features/cadastre/`)

### Roles (owner's words → measured roles)

| Role | Owner's sentence | Winner selector | Port hook |
|---|---|---|---|
| header share | "keeping only its start with claimed percentage" | `#band .b-claim` (the `38%` figure and its two-line caption) | `[data-role=cad-share]` |
| move tags | "continue with filter tags again (Wait on you, In trouble, Unclaimed)" | `.ftag` x3 | `[data-role=cad-tag][data-move]` |
| register row | "reduce a bit row spacing in left sidebar" (32 px rows, 28 px group headers, 14 px type) | `.row`, `.grp` | `[data-role=cad-row]`, `[data-role=cad-group]` |
| district | the cadastre baseline | `.dist` (frame `.dr`, title `.dn`, count `.dc`) | `[data-role=cad-district]`, `[data-role=cad-district-title]` |
| parcel | "pastel colors are eliminated" (deep tone fill, hue on the edge, dashed open ground, purple platform edge) | `.pc.c-<category>` per tone class (`.pf` is the fill) | `[data-role=cad-parcel][data-tone]` |
| survey line | the connecting lines | `.sv-line` | `[data-role=cad-survey]` |
| nested layer | "fuse B/1 as nested layer instead of using side drawer" | `#layer`, `.ly-head`, `.crumb` | `[data-role=cad-layer]`, `[data-role=cad-layer-head]`, `[data-role=cad-crumb]` |
| rose | "the design of pie/multidimensional rating is superior and should be preserved" | `.rosebox svg`, `.petal`, `.floor`, `.rose-cap` | `[data-role=cad-rose]`, `[data-role=cad-petal]`, `[data-role=cad-floor]`, `[data-role=cad-rose-cap]` (position: true for the hub) |
| action bar | state-driven action with its key | `.actbar .btn` | `[data-role=cad-action]` |
| figures | coverage ring, rounds trend, spend | `.fig` x3 | `[data-role=cad-fig][data-fig]` |
| envelope | scenarios as an envelope naming the worst cell | `.envcell`, `.envtag` | `[data-role=cad-envcell]`, `[data-role=cad-envtag]` |
| theming | "closer to A/1 ... background colors can reach more Personas feel" | `body`, `#register`, `#map`, `.tip` | `[data-role=cad-page]`, `[data-role=cad-register]`, `[data-role=cad-map]`, `[data-role=cad-tip]` |

The winner's variables (`--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-soft`, `--text-2`, `--text-3`, `--map-bg`, `--glow`, `--p-*` parcel tones, `--c-*` chip tones, `--hatch-*`) are the contract's colour side; each is re-pointed at a product token in `cadastre.css` and the light theme gets its own block.

### Components (each under 200 LOC)

`CadastrePage.tsx` (dispatch target, owns selection, filter, focus, keyboard) · `CadastreHeader.tsx` (share + three tags + project picker + 19/100 rehearsal in DEV; the theme switch is the app's, not the page's) · `Register.tsx` + `RegisterRow.tsx` (whose-move groups, sort by `FeatureSort`, 32 px rows, `j` `k` `Enter`, `/` filter as today) · `CadastreMap.tsx` (squarified districts from `board.groups` x `board.contexts`, parcels ordered by role then name, tones from `SquareTone` in `featureRules.ts`, rank badges, the lens on `l`) · `SurveyLines.tsx` (the selected deed's parcels joined) · `ParcelTip.tsx` · `DeedLayer.tsx` (full-scale layer: breadcrumb, `n of N`, `[` `]`, Esc; the transition uses `document.startViewTransition` when present and a `MOTION_PRESETS.gentle` cross-fade otherwise, both with a reduced-motion fallback) · `RoseFigure.tsx` (weighted wedges, dashed bar ring at `threshold`, floor bands, earlier rounds as faint rings from `council.history`, hatched ghost petal for a null score, envelope outer ring; radius from measured label widths so nothing clips at 1000 px) · `DeedFigures.tsx` (coverage ring with floor tick, round trend against the bar, 30-day spend or `not measured`) · `DeedActions.tsx` (reuses `featureActions.ts`, `DispatchChooserModal`, `PromoteConfirm`; every write confirms and the pressed control shows a real spinner) · `DeedSlice.tsx` (miniature cadastre with the survey line, hover lights a parcel) · `EnvelopeList.tsx` (numbered like the ring; reuses the scenarios model) · `UnclaimedList.tsx` (the `u` mode: unclaimed contexts by district with Draft) · `cadastre.css`.

### Interactions to drive (step 6)

Enter on a register row opens the layer with the transition and the rose blooms; `[` `]` step deeds and the breadcrumb follows; Esc closes and returns focus to the row; `w` `i` `u` filter and light parcels; `u` swaps the register for the unclaimed list; hovering a parcel names its claim; `l` lens draws the survey line; Promote to major opens the confirm with the numbers; the 100-row rehearsal keeps every register name unclipped at 312 px. Each drive asserts on the store (what the write would send), not on the pixels.

### Two things to fix in the port, not to carry

Narrow districts at 1000 px truncate their titles (`Candid...`, `Comm... & Sche...`) although the notes promise a two-line fallback: the port wraps at a word boundary and the contract checks the district title at 1280. The purple platform edge bars read as slider handles: the port keeps the role encoding but draws it as the winner's thin left edge at parcel radius, and the owner sees it in the first side-by-side before it is called done.

## 2. Council HUD: the fused instrument (`council/galaxy/fused/`)

The winner is the round-3 fusion: the round-2 Cross-section (baseline) with the round-2 Bezel as a second instrument, switched from the keyboard between **lens** (bezel), **bar** (the bottom cross-section, folded to needs-care at desktop width, spread on a wide monitor or with `S`) and **none** (the galaxy alone). The plan below is written before that seat lands; the roles table is confirmed against the delivered markup when it does, and this file is updated in the same commit.

### The field stays the product's engine

`GalaxyEngine.ts` already owns the data (`GalaxyLayout` from `registry_galaxy.rs`), the camera, `descend` / `climb` / `fit` / `zoomBy`, the lens, hit-testing, reserved rects for HUD cards and the 400 ms shared curve. The winner's `galaxy-core.js` is a second engine over the same fixture and is **not** ported. What is ported from its paint is a **style profile** on the engine (`classic` | `fused`) covering the four rules the owner accepted: labels never cover a node (eight candidate spots, two-line fallback, rank-number fallback, counted as hidden only when the number has no room); one level named at a time; halos and council rings capped at half the gap to the nearest neighbour; the re-toned claim palette (`--gx-ok`, `--gx-err`, `--gx-warn`, `--gx-none`) defined once and read by both the field and the instruments. `paint.ts` and `layout.ts` take the profile; the classic profile is byte-identical to today, proven by the existing galaxy tests.

### Instruments (React over the canvas, each under 200 LOC)

`FusedStage.tsx` (composes the engine, the instruments and the mode) · `hudMode.ts` (`lens` | `bar` | `none`, persisted `council-hud-mode`, default `bar` under 1600 x 900 and `lens` above, one key cycles, the name shown where it is switched) · `AltitudeTimeline.tsx` + `TimelineRung.tsx` + `NestedList.tsx` (Sky / Domain / Category / Subject / Technique rungs with the needle riding `engine.getCamera()` on the same curve; the current rung is the counts card; the level below is the numbered list with care marks; a row opens its children in place; `↑` `↓` `Enter` `Esc` `←` `→`) · `DecisionsPanel.tsx` (named decisions with overall or `not measured`, `W` cycles and lights stars; folds to its count on a narrow stage) · `CrossSectionDock.tsx` + `DockGroove.tsx` + `CareCells.tsx` (a `<canvas>` under the field: folded strip = one line of ticks plus care cells with threads; spread = one row per altitude with funnels and the preview row under the pointer; `S` and the three filter chips) · `BezelLens.tsx` (a `<canvas>` over the field: nested bands, one notch per technique, arc labels, lubber mark at 12 o'clock, amber decision blips, smoked-glass toning via the product tokens, re-engraves on `focus` and turns on the camera's curve; `←` `→` turn to the sibling) · `TechniqueDocument.tsx` (the pinned technique as a document ~60% of the stage: title, trail, figures, triggers, laws with reach bars and sibling chips, council evidence rows, prev/next) · `HudCommands.tsx` (Fit, Lens, Find, mode; each says what it will do on hover and focus) · `fused.css`.

Reserved rects: the timeline, the decisions panel and the dock register with `useHudReservations` so the label pass never places a name under them (the winner counts such labels as hidden and prints the count).

### Roles (to be pinned against the round-3 markup)

timeline rung / current rung card / nested list row / sounding bar / decisions panel + row / dock groove / care cell / spread row + funnel / bezel glass / bezel band arc + arc label / lubber mark / decision blip / tooltip / commands / technique document title, figures, law statement. Position is measured for the needle, the lubber mark and the decisions panel.

### Interactions to drive

Four clicks sky → technique with no zoom gesture, four Esc back to the same camera (the classic test, re-run on the fused stage); the mode key cycles lens → bar → none and the instrument animates on the camera's curve; in bar mode `S` spreads and folds and the chips filter; in lens mode `←` `→` turn the dial and the field flies with it; `W` lights the waiting subjects; a star inside the bezel is clickable where it is drawn; the timeline needle lands with the camera, not before it.

## 3. Order of work

1. **WP0 (Director, main tree, one commit):** the two switches (`featuresVariant.ts`, `councilVariant.ts`, the tabs in both headers, both persisted keys, i18n labels x14), empty `CadastrePage` and `FusedStage` stubs that render the shipped page's ghost, the two harness routes (`__shots__/harness.html?variant=cadastre|fused`), the two `roles.json`, the captured contracts from the winners (`style-contract.py capture`), and this file. Nothing user-visible changes with the switch on `board` / `classic`.
2. **WP1 (frontend builder, worktree `promote-cadastre`):** the Cadastre against its contract, to zero deviations at 1280 and 1920, both themes, with every interaction above driven; shots into the machine-local `.claude/features-reference/shots-app/cadastre-*`.
3. **WP2 (frontend builder, worktree `promote-fused-hud`, after round 3 lands):** the engine style profile first (classic byte-identical, tests green), then the instruments, against their contract; shots into `.claude/council-reference/shots-app/fused-*`.
4. **Director review by pixels** of the integrated page (the harness AND the live app through the bridge), side-by-side with the winner, before either variant is called done. Owner-requested departures are recorded as accepted overrides on the role, never by re-capturing the contract.
5. **Descoping the old variants** is a later, owner-called change: it deletes the `board` / `classic` trees, the switches and their strings, and re-baselines the census drops as real fixes.

## 4. What is deliberately not in scope

No Rust, no migration, no new command. No change to the shipped Board or classic galaxy beyond the switch. No theme switch inside either page (the app owns it). No CDN font: the winners load Inter from jsdelivr; the product's own font stack is the contract's family side, recorded as an accepted departure from the start.
