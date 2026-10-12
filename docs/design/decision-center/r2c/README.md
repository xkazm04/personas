# R2-C — Aurora Deck

Refine round 2, variant C, built on P2 "Deck & Ledger". Code:
`src/features/decision-center/prototype/directions/r2c/`. The structure, data, key grammar
and behaviour are P2's. This variant changes how it looks and moves.

## The visual idea

The deck floats in a field of slow aurora light keyed to the card in hand: its kind tone,
the primary, and its tier tone, over a floor that vignettes to dark. The light re-tints over
700 ms as you walk. The card in hand has a living conic border in its kind tone that circles
once every 14 s, and the queue behind it is two ghost cards tilted back in 3D. Each ghost
shows a lit lip, and the count of what is left rides the stack's edge. Verdicts land as big
stamps (verb plus a glyph, with a light burst). The decided card stays on top and flies off
along its meaning while the next one rises beneath it. On the strip, chips glow by urgency,
and only the chip that holds the roster's first item wears a ring and a breathing lamp.

## Material recipe (all in `aurora.css`, token-only, prefix `au-`)

| Technique | Where | Expression |
|---|---|---|
| Layered surface | card | `color-mix(in oklab, var(--background) 91%, var(--primary) 9%)` + top sheen `color-mix(… var(--foreground) 3%, transparent)` + inner highlight `inset 0 1px 0 color-mix(… var(--foreground) 10%, transparent)` + `var(--shadow-elevation-4)` + long shadow `0 60px 90px -50px var(--au-shade)` |
| Ambient tone light | card head, peek glass | `radial-gradient(70% 55% at 0% 0%, color-mix(in oklab, var(--au-tone) 16%, transparent), transparent 70%)` (7 % in light) |
| Living gradient border | card | `::before`, 1.5 px, `conic-gradient(from var(--au-angle), tone, transparent …, primary 55%, …)` masked with `mask-composite: exclude`; `@property --au-angle` animated over 14 s, static under reduced motion |
| Gradient hairline | peek | the same masked pseudo element, `linear-gradient(140deg, tone 55% → hair → transparent)` |
| Aurora field + vignette | deck | three blurred (56 px) radial blobs: kind tone, primary ×0.7, tier tone ×0.6, at 30 % (13 % light), drifting 20–32 s; vignette `radial-gradient(ellipse, transparent 55%, var(--au-shade) 70%)` |
| Cross-fading light | deck scope | `@property --au-tone / --au-tier` registered as `<color>`, `transition: 700ms` |
| Recessed rail | ledger well | `color-mix(in oklab, var(--background) 80%, black)` + `inset 0 2px 10px var(--au-shade)`; light theme: the canvas `var(--background)` sunk into the white card |
| 3D ghost stack | tray | `perspective: 1400px`; ghosts `translateY(18/36px) scale(.965/.93) rotateX(7/12deg)`, blur .5/1 px, opacity .85/.5, a tone-lit bottom lip |
| Real meters | rail | a capsule with a tone gradient fill, notched into ten segments with `repeating-linear-gradient` and clipped to the value with `clip-path: inset()`. Notches stay fixed to the track. The value in tabular figures, then the band word |
| Urgency glow | strip chips | a pool of light under the chip, `0 10px 18px -12px color-mix(lamp var(--au-pool))`, with the pool at 26 / 46 / 64 % for waiting / held / critical, plus a lamp-tinted bottom hairline |
| Hover | every pressable | lift 1 px plus a single highlight sweep (`.au-sheen`), and no bouncy scale |
| Light theme | all | `--card-bg` paper card, lower glow (7 %), lower aurora (13 %), shadows from `color-mix(var(--foreground) 16%)` |

Grain was considered and skipped. The aurora blobs already break up the banding, and noise
over a 0.82-brightness light theme only muddied it.

**A finding about the light theme.** The app dims the light theme by putting
`filter: brightness(.82)` on `<html>`. A nested `brightness(1/0.82)` on the card cannot undo
that, because the inner filter clamps white at 1.0 before the outer filter dims it. I measured
this and then removed the filter. At this brightness setting, no card can be whiter than
about 82 % grey. P2's grey card has the same cause. Separation in light comes from layering
and shadow instead.

## Icon vs text, per level

| Level | Icon (label in a `Tooltip`) | Text (kept on purpose) |
|---|---|---|
| Strip | chip kind glyph; lamp = urgency; failed = ⚠ (never 0) | the count (hero, bold tabular); chip label while it fits (drops to tooltip at 1280) |
| Peek | tier → glowing stripe (tooltip "Blocking / Decide / Read"); source → monogram; age → clock; cost → gauge; NEXT → breathing lamp | title (2 lines, never cut); source name; age; cost value |
| Card head | kind → lit tile glyph (shield / sparkle / siren / landmark / file / message …); tier → lamp (tooltip: "Blocking — Holding a team step") | eyebrow "GATES · REVIEW" said once; the ask (2 balanced lines); the consequence sentence; severity **word only on incidents** ("CRITICAL") |
| Ledger | waiting → clock, cost → gauge, source → monogram; first seen → history, occurrences → repeat, project → folder, spend → wallet, saves → piggy bank, members → users, action → zap; "lower is better" → ↓ | facts unique to the decision keep their word: a policy's "Quality delta" and "Cost" would be two identical-looking glyphs over two percentages. Meter dimensions (Effort / Impact / Risk / Confidence) keep their word beside the glyph, because three bars that differ only by glyph fail the 5-second test |
| Tags | — | at most 2, small caps plus a tone dot, no border or fill. Severity tags and tags that repeat the source or team are dropped (`cardTags`) |
| Dock | ✓ / ✕ / ↳ glyphs before the verbs | verbs (Approve / Reject / Resolve / Done / Reply / Send back), branch labels with hints, reason options |
| Keys | printed **once**, inset inside the control that fires them | the full map sits behind **Keys ?** (or the `?` key). Esc closes the map first. P2's legend bar is gone, and so are the keys in the consequence band and the peek footer's verdict keys |

## The 5-second answers

- **Strip.** *How many:* every count is a bold tabular hero, and **Triage all 16** carries its
  total in an inset pill. *What kind:* the glyph plus the label (or a tooltip at 1280).
  *Most urgent:* Incidents is the only chip tinted in its lamp colour, with a circling ring and
  a breathing red lamp. Held work (Gates) has an amber pool. Waiting chips are quiet.
- **Peek.** *Which first:* roster order, a red glowing stripe for blocking, and a NEXT lamp.
  *What it costs:* gauge + `1 key` / `2 answers` / `effort 3` at the end of every row.
- **Modal.** *What is asked:* the title sits beside the lit kind tile. *What yes does:*
  "If you approve — Approving resumes step 4 of the Growth pipeline, paused for 26h." in the
  alert tone, directly under the title. *Which key:* inset in the verdict button (`A`, or
  `A ↵` on council).

## What changed vs P2

- The strip has an urgency-glow material: the next chip gets a tinted fill, a conic ring and a
  breathing lamp. Counts are the hero (bold, larger, tabular, odometer roll with a blur
  trail). **Triage all** is an aurora-gradient button with the total in an inset pill.
- The peek is frosted glass lit from its chip's lamp, with a gradient hairline. Rows use a
  glowing tier stripe, a monogram, clock + age and gauge + cost, with titles on 2 lines.
  The "Blocking" word is gone. Verdict keys appear once, on the focused row.
- The deck sits in an aurora field over a vignetted floor. The tray bar is gone: the header
  floats chrome-less with a hero position numeral, a tier-lit track, **Keys ?** and icon walk
  and close buttons.
- The card is a layered surface with a living conic border, a tier spine of light and kind
  light from the head.
- **Layout.** The ledger is now a full-height recessed well on the right, and the header
  shares the left column with the body. This removed P2's empty acreage under a full-width
  header and gave the rail room, so backlog's three meters plus the dock fit without
  scrolling.
- Kind is a lit tile glyph, and tier is a lamp. There are no tier, kind, alert or tag pills.
- Meters are capsule bars notched into ten segments, not dot rows. The value is the hero, and
  inverted scales say so with a ↓ that has a tooltip.
- Waiting and cost are hero tiles (icon + value). Plain facts are icon + value, except the
  ones whose meaning is the decision.
- Dock: a lit "yes" button with a glow and a quieter "no", each with a glyph, its verb and an
  inset key. Branches are lifted tiles. A long verdict pair (council) stacks instead of
  wrapping. The council's explanatory caption is gone, because `A ↵` on the button says it.
- The stamp is bigger (hero type, a glyph and a light burst). The decided card stays on top
  (`zIndex 5`) and flies up-right +4° (accept) or down-left −4° (reject). Skip slides under
  the stack. The next card rises from the first ghost's position. The beat is 150 ms.
- The open morph uses spring 300/30 out of the chip or row, and the aurora fades in 80 ms
  after it.
- Chat: tinted bubbles per author, and the ask carries a breathing amber lamp and a glow.
  Participants show as monograms. The composer is a recessed well, and Send has an inset ↵.
- Reader: the sticky bar is frosted, the progress bar is a gradient, and the active contents
  item is lit. Contents labels wrap instead of truncating.
- Reduced motion: the ring, the border spin, the aurora drift, the lamp breathing and the
  sheen are all static. Card motion falls back to P2's fades, and the verdict commits with no
  beat.

## Before / after verdict per entry (P2 PNG vs R2-C PNG, same size and theme)

| Entry | Clarity | Visual quality | Verdict |
|---|---|---|---|
| strip | the urgent chip now pulls the eye (it was a thin underline); counts are heroes | depth, glow by urgency, gradient CTA | **better** |
| strip-failed-zero | Council ⚠ in a dashed red outline; Ready 0 is dark and stays in place; the total drops to 15 | same material | **better** (equal semantics, clearer weight) |
| peek-gates | no `Outreach…` truncation, titles on 2 lines, cost glyph, one set of keys | glass, lit stripes, monograms | **better** |
| peek-ready | green "accepted" stripes, Dispatch buttons lift | glass, lit header tile | **better** |
| modal-approval (incident) | CRITICAL said once, no duplicate pills, Resolve key once | aurora, living border, lit tile, well rail | **better** |
| modal-approval-r1 | no `Blocking`/`Holding…`/`High`/`Growth Team` pill noise; `Confiden…` is now "Confidence 8.2/10 good" in full; one key per action | as above, plus a real meter | **clearly better** |
| modal-backlog | three full-word meters with notched capsules; no scroll | capsule meters, recessed evidence | **better** |
| modal-report (council) | `A ↵` and Send back stacked, not wrapped; contents not truncated | frosted reader bar, gradient progress | **better** |
| modal-report-rep1 / rep2 (markdown / HTML) | consequence copy without a key; rating keycap inline | as above | **better** |
| modal-chat | the ask is the lit bubble; participants as faces; Reply is the lit verb | tinted bubbles, recessed composer | **better** |
| light (all) | same hierarchy | paper card on a sunk canvas well; but the whole page is capped at about 82 % white by the app's brightness filter (see the finding above) | **better, with that cap** |

## Shots

`<entry>-<W>x<H>-<theme>.png` for `strip`, `peek-gates`, `peek-ready`, `modal-approval`,
`modal-approval-r1`, `modal-backlog`, `modal-report`, `modal-report-rep1`, `modal-report-rep2`
and `modal-chat` at 1280x800 and 1920x1080 in dark-midnight and light. There is also
`strip-failed-zero-*`, driven by Playwright: the council-failed toggle plus Dispatch all.

```
node scripts/style/shoot.mjs --module decision-center/prototype --tape docs/design/decision-center/p2/tape.json --port 1461 --kit r2c:<entry> --out docs/design/decision-center/r2c --label <entry-with-dashes> --sizes 1280x800,1920x1080 --themes dark-midnight,light
```

The deep links `r2c:modal:<type>:<sourceId>` still work (Hub reads them).

## With one more day

- Use a real shared `layoutId` backplate from the chip to the deck, instead of the measured
  origin transform, so the plate visibly *is* the chip as it grows.
- Have the empty rail space on short items (an approval with one meter) carry something
  useful: the run's last three steps, or the "Open the run" link as an icon row.
- Capture the stamp beat on video. Frame screenshots cannot catch 150 ms, and the fake-clock
  frames prove ordering but not feel.
- Light theme: ask whether the decision deck should be exempt from the global brightness
  dimming (a `brightness-lock`-style token for raised surfaces). That is a design-system
  decision, not a variant's.
- Compact strip at 1280: a two-letter kind label under each glyph so "what kind" survives
  without tooltips.
