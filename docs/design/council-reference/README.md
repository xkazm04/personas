# The Council — owner-approved design reference

This directory holds **one static HTML artifact** that is the agreed target for the Council
page (the galaxy of the organisation's engineering knowledge → the queue of subjects waiting
on the person → one council's evidence → the gate). It was fused from the two prototypes the
owner judged, and it is kept here **for the whole implementation**: every Personas build of
this surface is compared against it.

Open `index.html` from `file://`. No build, no server, no network. It loads `./data/*.js`.

## The owner's verdict, verbatim

> "Sunflower ... is the winner for galaxy layer - the knowledge base exploring. For Lens
> feature i would reduce size of the len circel to 20% of its current siye. The bench/queue
> seems to be best designed in B/3, try to fuse the experience into [Sunflower]. Keep the
> fused variant as static artifact to keep through the implementation so I can compare always
> with versions which will end up in Personas."

## What came from where

**The galaxy layer is the winner's, unchanged in substance** — ten globular clusters packed so
none collide, numbered 1–10 in name order; categories as sub-discs, rank 1 nearest the core;
subcategory wedges A→Z clockwise from twelve with subjects spiralling outward; techniques on a
sunflower spiral around their subject; the rank number printed in the canvas, the tooltip and
the docked list; the docked, filterable, keyboard-driven sidebar; the camera (`Esc` climbs one
layer and restores it exactly); the rim arc of council state; the design tokens, light/dark
themes, spacing, glyphs and motion; and the bench as a drawer that rises over the bottom of the
field and **never hides the sky**.

**The bench — queue and council detail — is the donor's experience, re-skinned into the
winner's visual language.** Specifically taken from the donor:

| Taken | What it is |
|---|---|
| queue structure and ordering | three named groups — **Yours to decide** / **Not waiting on you** / **Decided** — each with a one-line note, each sorted by title; the count that matters is the number of *decidable* rows, in the headline |
| queue row | a 54 px **mini rose** + title + state chip + `project · round n` |
| queue item detail (the preview) | chips (state, project, tier/kind, star count) → title → the rose → the council's one-sentence reading → **Sit at the round table** |
| the round table | header (chips, 34 px title, round history, constellation of the stars it touches) · left: the rose, the why-line, the coverage ring, the rail legend · right: the five member seats and the member's reading · footer: the gate, always in view |
| the rose | wedge **width** = the member's weight, **reach** = its score, one ring = the threshold, floors drawn as arcs (dotted when advisory), `carried` striped, **not measured hatched at full reach** |
| member reading | seat tabs `1…5` with the weakest marked ▼ · big score or `NOT MEASURED` · the rail (fill, knob, threshold rule, floor mark, floor zone) · kind, weight bar, confidence bars, floor, delta · findings with severity and recurrence dots · rival dots · evidence drawn as graphics (minutes-saved bars, gate pips, cost) with honest placeholder frames for the video/screenshot that are not on disk · technique proof glyphs · must-address · stars this touches · the receipt |
| the walk to the gate | queue → preview → table → the gate pinned in the footer; approve is **armed then confirmed**, reject opens a box that stays disabled until a reason is written |
| the sentences | the gate's one-line reason per state, and the council's "why" line |
| typography hierarchy | 13 / 14 / 15 / 16 / 17 / 21 / 31 / 34 / 42 — one large number per screen, prose at 16 px |

The donor's own chrome (its fullscreen L2, its glass lens layout, its sidebar) was **not**
taken: the galaxy layer stays the winner's, and the round table lives inside the winner's
bench so the field is still alive above it.

## What changed, beyond the fusion

1. **The lens circle is at 20 %.** `LENS_R` **250 px → 50 px** (diameter 500 → 100). To keep it
   readable at that size the magnification was retuned: `LENS_M` **2.6 → 5.2**, i.e. centre
   magnification **3.6× → 6.2×**, and the Sarkar–Brown factor is now **clamped at 1** so nothing
   inside the small circle is ever drawn *smaller* than it is outside (the old falloff shrank the
   rim, which at 50 px would have hidden more than it revealed). The circle gained a faint glass
   fill and an accent rim so it reads at that size, and a star the lens actually magnifies
   (>1.9× at depth, >2.6× on the sky) is **named at 15 px**. Nothing else about the camera or the
   zoom changed — the lens still magnifies locally instead of adding a zoom level.
2. **Type floor.** Every rendered size below 13 px was raised. Measured in the browser across
   five states (sky, deep altitude, queue, round table, after a decision): **minimum rendered
   font size 13 px**, prose 16 px, member scores 42 px. The winner's 11.5 px `kbd`, 12.5 px list
   metadata and 12.4–12.8 px SVG chart labels are gone.
3. Smaller corrections found by looking at the screenshots: the round history moved into the
   table's header so it is visible without scrolling; the rose is sized from the bench height so
   the rose, the why-line and the coverage ring always clear the fold; the toast moved off the
   queue it reports on; the sidebar's level tag no longer collides with the level name; and a
   decision now repaints its stars **at sky altitude too**, not only at depth.

## How to open it

Double-click `index.html`, or `start index.html` / `open index.html`. Sized for 1280×800 and
1920×1080. Both themes work; `T` switches.

## Keyboard map

| Key | Does |
|---|---|
| `↑` `↓` | move in the docked list, or in the queue |
| `Enter` | descend a level · sit at the round table |
| `Esc` | climb one layer; the camera returns exactly |
| `L` | lens on/off — magnifies under the pointer without changing zoom |
| `Q` | raise or drop the bench; the galaxy stays live above it |
| `1…5` | at the table, hear one council member |
| `←` `→` | previous / next member |
| `[` `]` | earlier / later round |
| `G` | go to the gate — it focuses a button, it never commits |
| `/` | filter the current level · `T` theme · `?` this map |
| `+` `-` | zoom the field |

No single key commits a decision: approve is armed and then confirmed, reject needs a written
reason of at least 12 characters.

## The rules this artifact holds (verify any rebuild against these)

- Approve / Reject appear **only** when the subject is `ready` **and** (`tier: major` **or**
  `kind: architecture`). Every other state shows a closed gate with one sentence saying why.
- `machine_pass` is **not** waiting on the person — it sits under "Not waiting on you" and is
  excluded from the headline count.
- Rejecting requires a written reason, and the reason is shown back on the closed gate.
- A `null` score draws as **NOT MEASURED** — a hatched wedge at full reach and a hatched rail —
  never as zero, and it contributes nothing to the overall.
- "The instrument is uncalibrated, so judged floors are advisory; mechanical floors bind" is
  said **once**, in the queue header. Elsewhere the advisory floor is simply drawn dotted.
- Approve / reject mutate in-page state only, and the change is visible in the queue, in the
  sidebar pips and on the galaxy on the way back up.
- No frame loop at idle (measured: 0 `requestAnimationFrame` calls in 2 s with nothing moving).

## Port notes for the React 19 + Tailwind 4 implementation

- **The canvas is the hard part, and it is not React state.** The field, the labels, the
  fisheye and the pick list are per-frame canvas work behind one `<canvas>`; drive it from a
  ref-held engine with an `invalidate()`, not from render. Nothing in the galaxy should be a
  React component.
- **Keep the invalidate discipline.** Drawing happens on demand (`invalidate()` → one rAF), and
  camera moves run their own tween. A `useEffect` that redraws on every state change will
  re-introduce the idle loop this artifact does not have.
- **The rose, the rail, the coverage ring, the rounds chart, the constellation and the proof
  glyphs are plain SVG** — they port directly as components, and they are the pieces worth
  extracting first (`<Rose>`, `<MemberRail>`, `<CoverageRing>`, `<RoundHistory>`).
- **The gate is a rule, not a widget.** `decidable = state === 'ready' && (tier === 'major' ||
  kind === 'architecture')` belongs in one shared predicate used by the queue grouping, the
  headline count and the gate — three places that must never disagree.
- **Absence needs its own type.** `score: number | null` with `state: 'measured' | 'carried' |
  'unmeasured' | 'not_applicable'` must survive the binding layer; a `number` defaulting to 0 is
  the one change that would silently break the whole design.
- **The two-step approve is deliberate.** Keep the arm→confirm (and the reject reason gate) in
  the component that owns the mutation, not in a global key handler.
- **Token mapping.** The artifact uses the app's semantic tokens under its own names:
  `--ink-1…4` → `foreground` / `muted-foreground` / `muted`, `--panel`/`--panel-2`/`--panel-3` →
  `card`/`secondary` surfaces, `--hair`/`--hair-2` → `border`, radii and elevations map 1:1.
  Light theme is an ink-on-plate design, not an inversion.
- **Type scale.** Nothing below 13 px; prose 15–16 px; one large number per screen.

## Files

```
index.html                  the fused prototype (self-contained)
data/topology.js            10 domains · 58 categories · 471 subjects · 3,260 techniques · 98 laws
data/council-state.js       the council fixture: 8 councilled subjects, 2 full runs of one of them
data/SCHEMA.md              what those two files contain
shots/                      verification screenshots, captured at 1280x800
```

`shots/`: `01-sky-dark`, `02-sky-light`, `03-lens` (+ `03b-lens-crop`, the 100 px circle up
close), `04-deep-altitude`, `05-queue`, `06-detail-ready` (the open gate),
`07-detail-closed-gate` (a machine pass), `08-after-reject` (+ `08a` the gate that recorded it),
`09-galaxy-after-decision` (the repainted star), `10-keyboard-end`.
