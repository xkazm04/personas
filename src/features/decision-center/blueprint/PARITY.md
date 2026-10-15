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

## Across levels (header, rails, bars)

| Element in bp | Verdict | Here |
|---|---|---|
| Header: DRAWING SET chip, ledger count, sheet number and name | present | title block; the count is the Build queue |
| Header: crumbs (product, wing, room, bay) with live, building and waiting counts | present | each crumb is a way back up |
| Header: product switch | dropped | one product per sheet: the Build card that opens the sheet chooses it (WP3) |
| Header: last scan | improved | stated in the identity line, relative to now |
| Lens tabs: short code, waiting count, digit key | present | General, then every enabled lens in map order |
| Lens tabs: custom project lenses on a second row | present | second row, drawn with the manifest's own glyph path (Kettle's Cost lens) |
| Performance lens (bp's 7th built-in) | present | `PERF` tab; the stopwatch glyph on tiles, flags and cards (canvas and SVG) |
| Theme toggle | dropped | the app's own theme owns it; the canvas re-reads its tokens when the theme changes |
| Right rail: Find, review, agents, plan | present | Find, Build queue (shown or hidden), agents running, plan |
| Right rail: View (7 d window) | dropped | a no-op in the prototype; the timeline strip keeps the history |
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
| Blast radius (B) | dropped | outside the brief; the map's dependency edges are loaded and can feed it later |

## Dropped for the whole sheet

| Element | Reason |
|---|---|
| Swarm line, room art | no data in the stores the sheet reads |
| bp's Kettle-only named wings | the fixture takes the path a live product takes: one wing per domain |

## WP4b: the compare panel and triage in the L4 sheet

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
