# Blueprint drawing set: parity with bp, level by level

Spark one-control, Stage 2, WP4a. The drawing is bp's (`bp/src/engine`, `bp/src/lib/model/layout.ts`,
`bp/src/lib/standard/load.ts`), ported through the r3-r2 prototype "The Queue Beside the Drafting Sheet". The
reference is bp's own shots of two live products at L0 to L4, dark and light (`.contest/staging/one-control-r3-shots/`,
read for layout only: nothing from them is copied here). Ours are in `shots/` and are drawn from bp's synthetic
sample, Kettle. Verdicts: **present** (same element), **improved** (same element, better), **dropped** (with the
reason).

Lenses: the registry comes from the map's `lenses[]`, so the sheet draws the seven built-in lenses (Business, Design,
Development, Operations, Security, Quality and Performance) and any custom project lens the same way. Kettle carries
one custom lens, `com.kettle.cost`.

## Round two (spark bp-fidelity, 2026-10-16): bp's look restored

Round one re-inked bp in the app's tokens and lost bp's detail. Round two re-ports bp closely and adapts it
(strings, file size, the app's style rules); where bp and the round-one rows below disagree, bp now wins.
Reference shots: bp itself on :3010 (Kettle sample and live products), compared side by side.

- **Palette and type:** bp's own palette, dark and light, verbatim in `theme/bp-tokens.css` as `--bp-*`
  (operator decision: inside the blueprint bp's palette serves better). IBM Plex Sans Condensed and Plex Mono,
  bundled with the blueprint chunk only. Square corners, no glow. Text never under bp's 12 px floor: the app's
  text-scale factor can enlarge the sheet but is clamped at 1.
- **Ground:** bp's radial paper, vignette and double frame (`theme/ground.css`), the canvas transparent over them;
  the 40/200 world-unit grid in the accent.
- **Drawing (engine/):** bp's render ported: walls with the poche hatch, wing floors by share live, ribbons
  crossfading into tiles, wing / room / bay label anatomy, the chronology rule, ink-only stage glyphs, delta
  triangles, trouble clouds, flags and clusters, the static raster cache. Left out: bp's simulated swarm (agent
  dots, heat, scans), which the stores do not carry.
- **Chrome (ui/, styles/):** bp's header (project line, crumbs, count summary with its drop tiers, two-row lens
  tabs with the lens underline), the **project switcher** with bp's shape-only readiness icons (header product
  switch: now present), the last-scan pill, bp's rail (count-up figures, tones, badge, pulse; View shown, its panel
  arrives with the rail panels), the ladder and scale bar, the collapsed timeline strip. The Build queue column (a
  Personas addition the operator kept) and the dialogs are drawn in bp's workbench language.
- **The Monitor's Blueprint tab** is bp's project list (Manage projects as a page: readiness icon and checklist,
  counts, open buttons) on bp's ground. Registering, renaming and removing projects stay in Personas' Projects page.
- **Findings ledger (stage B):** bp's second page over a product (L, or the DRAWING SET | LEDGER switch):
  Triage table, Feature x lens matrix and Release tabs, In packs | Backlog, status and lens filter chips, pack rows
  with decided marks, the compare panel in every mode (light / dark / both x side by side / slider / blink / change
  map, wide W), the decision bar and batch moves over checked rows. bp's ledger palette sits in `bp-tokens.css`
  (`.lg-page`). The Release tab is read-only: Cut, Finish and Undo open bp's Release tab; LENSES opens bp (lens
  authoring stays in bp). Left out: scan writes from lens chips, the backlog's approve-and-execute Dispatch (Build
  stays the queue's B), the release job log. The Build queue column steps aside while the ledger is up.
- **Rail panels (stage C):** bp's flyouts: Agents (the store's runs and the starts this sheet sent), Plan (in
  trouble / all features, the title block and the Legend, drawn with the engine's own glyphs) and View (the recent
  window, 24 h / 7 d / 14 d, and what changed in it). Review stays the Build queue toggle. Orders and Steer are bp's
  simulation and are left out.
- **Feature page (stage D):** bp's L4 page: the morph out of the tile, the detail bubble, the stage ladder,
  General's headline tile per lens, each lens tab's hero, evidence cards, metric rows with sparklines and targets,
  KPIs, screens, Lives in code, the drawing, revisions, parts and the red-pencil notes (Caveat). The proposals with
  their controls and the compare entry stay. Sparkline floors are pinned at 0 (the app's plot-scale rule).
- **On the plan (stage D):** the expanded timeline (T: key plan, as-of clock, revisions chart, milestones, releases,
  scrub) with time travel (the plan replays its stages at the date; BACK TO NOW), bp's hover card, the on-plan
  decision card for the current waiting item, multi-select (Space, or Shift+click a tile) with the selection bar's
  batch moves. bp's simulation (next hour, speed, Morning, the swarm) stays out.
- **Keys:** bp's win where round one differed: L is the ledger, T the timeline, Space selects; wings walk on the
  arrows only.

## Across levels (header, rails, bars)

| Element in bp | Verdict | Here |
|---|---|---|
| Header: DRAWING SET chip, ledger count, sheet number and name | present | title block; the count is the Build queue |
| Header: crumbs (product, wing, room, bay) with live, building and waiting counts | present | each crumb is a way back up |
| Header: product switch | present (round two) | bp's switcher; picking a product reopens the sheet on it |
| Header: last scan | improved | stated in the identity line, relative to now |
| Lens tabs: short code, waiting count, digit key | present | General, then every enabled lens in map order |
| Lens tabs: custom project lenses on a second row | present | second row, drawn with the manifest's own glyph path (Kettle's Cost lens) |
| Performance lens (bp's 7th built-in) | present | `PERF` tab; the stopwatch glyph on tiles, flags and cards (canvas and SVG) |
| Theme toggle | dropped | the app's own theme owns it; the canvas re-reads its tokens when the theme changes |
| Right rail: Find, review, agents, plan | present | Find, Build queue (shown or hidden), agents running, plan |
| Right rail: View (7 d window) | present (round two) | bp's View flyout: the recent window and what changed in it |
| Level bar: zoom, LEVEL, L0 to L4 | present | the current level inked, the levels passed shaded |
| Level bar: TARGET cell | dropped | no target mode here: the queue's current item is the target |
| Level bar: names drawn | improved | NAMES `n/total` cell with a tooltip saying why a name is missing |
| Scale: `SCALE 1:n` with a bar at the site | present | bottom left, above the level bar |
| Timeline strip: NOW, REV, scan done, ticks | present | ticks from the events log: stage changes tall, additions green, retirements red |
| Key plan (L1 and deeper) | present | follows every frame; marks the fixture on the L4 sheet |
| Hover card | present | the feature, its stage, the flagging lens and why, what waits on it |
| Find (/) | improved | wings, bays, features and queued work in one list, with match count and key hints |
| Key sheet (?) | improved | the one keymap, four groups |

## L0 site

| Element in bp | Verdict | Here |
|---|---|---|
| Wing titles with letter bubbles, counts, stage bar | present | stats line reads "Features: n, live, building" and sits under the title |
| Wing waiting pennant with its count | improved | rides the stats line, never over the wing's name |
| Trouble counts per wing | present | "n in trouble" |
| Stepped footprints, double walls with poche | present | plus registration ticks at every wing corner (the Twin sheet's) |
| Ribbons: one segment per feature, stage fill | present | |
| Room labels | improved | on paper, not on grey boxes |
| Counted pennants per room | present | amber waiting, mint approved-not-built (new) |
| Clustered lens flags | present | red for bad, amber for watch, a count when clustered |
| Chronology rule (oldest to newest) | present | |
| Lens sheet (a lens shows only its own flags, its own bar) | present | the stage bar becomes a health bar |

## L1 wing

| Element in bp | Verdict | Here |
|---|---|---|
| A wing among its neighbours at 1:83 | present | level scale capped at bp's; a test holds it (`levels.test.ts`) |
| Rooms and bay tags (code, name, count) | present | plus "n waiting" beside the count |
| Fixtures with the lens strip and the stage word | present | one glyph per lens in the colour of its verdict |
| Item pennants | improved | an approved item flies a mint pennant with a check |

## L2 room and L3 bay

| Element in bp | Verdict | Here |
|---|---|---|
| A room inside its wing, every bay, every fixture named (1:67) | present | one step deeper than L1; a test holds it |
| Bay at one more step; doubled feature titles | present | |
| Stage word, trouble stamp, flags | present | the stamp is the rule's short reason |
| Waiting pennants on each fixture, the current one ringed | improved | the ring is purple, pulses, and stops under reduced motion |

## L4 feature

| Element in bp | Verdict | Here |
|---|---|---|
| Crumbs and Back to plan (Esc) | present | |
| Detail number circle, kind and tier, name | present | |
| Stage legend with the current stage inked | present | |
| Lens tabs with a measured mark | present | General overview plus every lens |
| Summary and the plain-words stage | present | |
| Lens cards: code, verdict word, value, history, why | present | a sparkline from the store's readings; "why" from the matched rule |
| The scan on this feature: proposals with Approve and Decline | improved | every store status is drawn (see the state table), with its note |
| Option rows: approve, decline, arm the build | improved | each carries its real key (A, X, B), not a digit |
| Athena-style pack: built items with before and after readings | present | read-only here; triage belongs to the compare panel (WP4b) |
| Owner, built by, flagged by, stage and since | present | |
| Lives in (surfaces, contexts) | present | |
| Revisions table | present | from the events log |
| Illustration of the feature | dropped | the live stores carry no art; a key plan stands in |
| Blast radius (B) | present (2026-10-30) | the decision brief's blast line: the feature, its room, the features that depend on it (it opens their list) |
| The decision brief on a waiting card (bp 51e193e, "one morning, with memory") | present | `model/brief.ts` is bp's `brief.ts`, held byte for byte by bp's golden (`standard/decision-brief.golden.json`, `__tests__/brief.golden.test.ts`); the card shows the advice chip and at most five fact lines, the declined line in amber, each fact opening its evidence. On a repeat (`withdraw`) Decline is the first answer, "You declined this before", Approve stays as "Approve anyway", and X opens the reason pre-filled with the note naming the decision it repeats (`repeatNote`), sent through `lens_scan_decide`. A like idea declined elsewhere (`ask`) keeps Approve first. bp's Enter-takes-the-recommended-option is not ported: Enter on an open feature says the enter hint, as before. No key is bound (Y stays triage accept) |

## Follow bp's shared focus (spark roadmap S6, first half, 2026-10-30)

| Element in bp | Verdict | Here |
|---|---|---|
| The follow chip ("Following Web, 2 s ago") | present | `ui/header/FollowChip.tsx`, a live product only: Follow bp / Following <who moved> / bp offline |
| Reader presence (hello every 15 s, forget on close) | present | as `personas:main`; bp's own chip lists Personas while the sheet is open |
| Following whoever moves, applying a new place (`toApply`) | present | `model/focus.ts` is bp's `session/focus.ts` @ c16732c, held by bp's golden `packages/schema/golden/shared-focus.json` (`__tests__/focus.golden.test.ts`); `model/focusPlace.ts` maps a place: site -> level 0, wing `0:<domain>` -> the wing, room (a capability since bp 57ee810) -> the same Personas bay (the fixture map) or room (a v3 map, measured on bp's demo 2026-10-31), a bp bay -> the same bay or its capability's, a bp domain-group wing (`0:FND`) -> holds still (no node in this layout), feature -> its L4 sheet with `lens=` from the hash; an id the plan does not draw holds still and says so |
| The transport | improved | Rust reads bp over loopback (`bp_link`: the webview cannot reach bp); the sheet asks once a second and Rust holds an offline answer for 5 s |
| A place on another product | present (S6, 2026-10-31) | the sheet reopens on that product at the place (`place` on `LensSheetRequest`); a product Personas has not got holds still and says "Not in Personas: <slug>" |
| Publishing the shared focus | dropped | G7, the owner's decision: Personas follows, never publishes |

## Dropped for the whole sheet

| Element | Reason |
|---|---|
| Swarm line, room art | no data in the stores the sheet reads |
| bp's Kettle-only named wings | the fixture takes the path a live product takes: one wing per domain |

## Wave three (/perfect, 2026-10-17): live data you can trust

Not a bp port: Personas additions on top of round two, aimed at realtime transparency.

- **Live sheet:** the sheet re-reads its product on the app's PollingCoordinator (5 s while a store run runs or a
  started build is unsettled, a 60 s sweep otherwise, on focus/visibility, never while hidden). An identical read
  changes no state and no canvas raster (`controller/useSheetData.ts` `mergeRead`); an older completion is dropped
  (`createLatestWins`). bp re-reads its store on its own simulation clock; the stores here have no push channel.
- **Started builds:** a build started from the sheet follows the fleet sessions carrying its `personas:<uuid>` run
  label (`live/startedModel.ts`), settles only when no running execute run still covers its items, re-reads the
  moment its last session ends, and marks its queue rows "building". Aborted runs are their own state.
- **One count:** `model/counts.ts` is the single source of the sheet's DOM figures (in trouble = bad; watch its own
  figure; live counts flagged inside it). Off-plan proposals are named in the queue column, never dropped.
- **Absent is absent:** no later reading poses as a before; risk not stated; not measured; kinds in words; a store
  that did not open says so in the project list.
- **Room to work:** the flyout narrows the plan when the plan keeps 480 px beside it (bp's `setFlyoutWidth` only
  keeps overlays clear; this is a design call), else lies over it as in bp; bp's flyout exit animation is now
  brought. The lens strip counts the sheets it cuts off; the crumbs clear the drawn titles; the key sheet and the
  timeline clock fit at 1280. The queue footer lists L, T, Space and a clickable `?`.
- **Not built:** a "read N s ago" freshness stamp, a "could not refresh / Retry" note and a Retry on the error frame
  (proposed, declined by the operator).

## WP4b: the compare panel and triage in the L4 sheet

> **Superseded in part by round two:** Wide (W), blink, the change map, the release package pill, multi-item
> decisions (Space, the decision bar) and the "why not" tooltip on the decision buttons all exist now in the
> ledger's compare panel (`ui/compare/ComparePanel.tsx`, `ScreenModes.tsx`, `useChangeMap.ts`, `ledger/Decide.tsx`).
> The "dropped" verdicts below record the L4 sheet of Stage 2 and are kept as history.

Spark one-control, Stage 2, WP4b. bp's release ledger (`bp/src/components/ledger/train/`, commits `4044c29`,
`99693aa`, `48171a1`) holds the compare panel beside a packs table; here it docks in the L4 feature sheet in the side
tables' place, beside the feature's pack rows. The pure logic is the committed port (`src/lib/lensScan/compare.ts`,
`wire.ts`); bp's `src/lib/train/perf.ts` is ported verbatim as `model/perf.ts`. Shots: `shots/state-compare-*`,
`state-compare-perf-*`, `state-rework-prompt-*`, `state-reopen-refused-*`, `state-in-release-*`.

Module map (bp -> here): `ComparePanel.tsx` -> `ui/compare/ComparePanel.tsx` + `CompareBody.tsx`; `MetricStrip.tsx` ->
`MetricLine.tsx`; `PerfTable.tsx` + `PerfRange.tsx` -> `PerfTable.tsx` + `PerfRange.tsx`; `Screens.tsx` + `ShotFigure.tsx`
-> `Screens.tsx` + `ShotFrame.tsx` + `useShotUrl.ts`; `CommitDiff.tsx` -> `CommitDiff.tsx` + `patch.ts`; `Measurement.tsx`
-> WP4a's `sheet/PackEvidence.tsx`; `ItemText.tsx` -> the shared `DeferredMarkdown`; `Decide.tsx` (compact) ->
`TriageBar.tsx`; `NoteEditor.tsx` -> `ReasonDialog.tsx` (the WP4a decline prompt, now every note); `ItemRow.tsx` ->
`sheet/PackRow.tsx`; `keymap.ts` + `KeysSheet.tsx` -> the ONE `model/keymap.ts` + `ui/KeySheet.tsx`; `useChangeMap.ts`,
`ChangeMap.tsx`, `changeMap.worker.ts` -> dropped (below).

### The compare panel

| Element in bp | Verdict | Here |
|---|---|---|
| Head: lens, id, pack and "item n of m", feature, title | present | plus the store's status chip |
| Head: previous / next (K / J) over every pack item, packs oldest first | present | J/K walk while the panel is open; the sheet follows the item's feature |
| Head: Wide (W) | dropped | the panel already takes the sheet's wide column; W is free in the keymap for later |
| Head: close (Esc) | present | Esc closes the panel before the sheet (one layer per press) |
| Item not found callout | present | |
| Metric strip: before -> after, unit, verdict chip, better direction, target, method | present | the verdict is compare.ts verdictOf: Better, Within noise, Worse, Not measured |
| Performance table: runs, median, after, change and %, noise (spread or one frame), target | improved | the item's name and verdict head its rows, so the six figures fit the panel at 1280 without a scroll |
| Outlier run outlined | present | with a screen-reader word, not a hover title |
| Range strip: noise band, runs, after, target and warn lines | present | |
| Context rows: the lens's other metrics at the base, against their targets | present | |
| The whole pack table | present | the pack's other items measured in runs |
| Why the verdict (one sentence) | present | |
| Failed build callout | present | |
| Screens: light / dark / both | present | starts at the app's own theme |
| Screens: side by side, slider | present | the slider drives a CSS variable; dragging never re-renders |
| Screens: blink | dropped | a timed swap needs a reduced-motion twin and adds no evidence the slider lacks |
| Screens: change map (pixel diff in a worker) and its words | dropped | the pixel engine (bp pixels.ts, a worker, a module cache) is not ported; a live store's object URLs would need decoding off the main thread first. bp's pixel checks are not ported with it |
| Prefetch of the next item's screens | dropped | each frame asks the seam for its URL when shown, and revokes it on unmount (source.ts contract) |
| "Smallest text" from the harness report | present | |
| What the measurement says (before/after evidence lines) | present | WP4a's evidence table: every phased reading, not only the latest |
| Commit: files with add/delete bars, message with trailers, patch | present | fetched through `actions.commitDiff` when the item is shown, a ghost under the heading meanwhile |
| Patch cut at 2000 lines, "truncated at n of m" | present | the panel also holds the cut itself if a source sends more |
| Patch rendered in chunks with content-visibility | dropped | the patch mounts only while open; 2000 rows stay cheap |
| No commit: why (failed build or none recorded) | present | |
| The item's text under its standard | present | the shared markdown reader instead of bp's own renderer |
| Footer: state mark over the triage note or what the state means | present | |
| Footer: flagged mark (accepted from failed/flat/unmeasured) | dropped | Personas shows the verdict chip beside the state instead; the store has no flag column |

### The decision bar and keys

| Element in bp | Verdict | Here |
|---|---|---|
| Accept (A), Rework (R), Descope (S), Undo (U) | improved | Y, R, S, U in the ONE keymap: A is already approve and a key is bound once. Keys and buttons always send: the store answers, the dock console prints it |
| Disabled buttons with a "why not" tooltip | dropped | the brief's rule: the drawing never decides whether a move is allowed; a refusal comes back as the store's `skipped[]` reason |
| Note editor inline in the footer, Enter / Esc, three quick notes | improved | the WP4a note prompt (a dialog), with a live preview of the exact `triage(...)` call; quick notes dropped (canned reasons stand in for the note the next run reads) |
| An empty note refused in place | dropped | an empty note is sent as no note; the store refuses a failed build's accept with `note-required`, shown in the console |
| Pending state until the store's change arrives | improved | the pressed control shows the shared Button's spinner; the row's status is the store's after a re-read |
| Toast with what was skipped and why | improved | the dock console prints the answer verbatim (decision, by, triaged, each skipped row with its reason and its gloss, packs triaged, packs reopened) |
| Selection, multi-item decisions (X, Space) | dropped | the L4 sheet decides one item at a time; X is decline here |
| Release package pill (Package v... · n accepted, Release ->) | dropped | release composition is bp's (out of scope); WP3 shows it read-only |
| Next waiting item after a decision | dropped | the panel stays on the item so its new state and the console answer read together; J walks on |
| Keys sheet (?) | present | one more group, Triage |

## Follow bp from the Monitor, the Morning deck, and Enter (spark roadmap S6, 2026-10-31)

| Element in bp | Verdict | Here |
|---|---|---|
| One reader per surface (web, phone, table) | adapted | one reader per window (`personas:main`, `lens/bpFollower.ts`), shared by the Monitor's Blueprint and Morning tabs and the sheet: hello every 15 s while one of them is on screen, nothing while hidden (bp drops the reader 45 s later), forget 1 s after the last one closes |
| The product a place names | improved | bp's product table matched on the canonical root (`bp_products`), never the folder name; the Release link uses it too (the folder name only while bp does not answer) |
| The Morning deck (`MorningWatch`, `GET /api/companion/morning`) | present, read-only | `lens/morning/MorningDeck.tsx`, the Monitor's **Morning** tab, read through Rust `bp_morning`; the cards in bp's order with their briefs; **O** opens a card's place in the drawing |
| Approve on a decision card | adapted | through Personas' own `lens_scan_decide` into the store (never bp's `POST /api/companion/morning`, which needs bp's human token); bp's deck drops the card on its next read and the tab re-reads at once |
| Decline on a repeat (the brief's `recommend`) | present | offered on a repeat only, with the brief's note; Enter takes it, as in bp |
| Enter | extended | owner decision D14: Enter takes the recommended answer on every decision, Decline on a repeat, else Approve (bp's deck binds Enter on a repeat only); the same on the sheet's waiting items |
| Defer and Hold | dropped | G8: they write bp's steering log; a link opens the card in bp (`?product=<slug>&morning=<card id>`) |
| Publishing the shared focus | dropped | G7, the owner's decision |
