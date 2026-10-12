# R2-B — Swiss Instrument

Refine round 2, variant B of the Decision Center spark. It is P2 "Deck & Ledger"
redrawn, with the same structure, data, key grammar and behaviour. Code:
`src/features/decision-center/prototype/directions/r2b/`. The material lives in `r2b.css`.

## The visual idea

The Decision Center reads like a measuring instrument, not a dashboard of pills. A strict
typographic grid holds it together: hanging small-caps labels sit in a margin column and
every piece of content shares one left edge, with hairline rules between rows instead of
boxes. The numbers (counts, waiting time, cost, scores, position in the deck) are the
heroes, set as large tabular figures. Every surface is monochrome, and each kind wears
exactly ONE accent: its index rule, kind tile and eyebrow. Colour is otherwise spent only
on meaning: lamps for urgency, the green verdict, the meter bands.

## Material recipe (all colour from tokens, all font sizes from the type scale)

| Technique | Where | Expression |
|---|---|---|
| Layered plate | card, peek, tray head | `color-mix(in oklab, var(--background) 93%, var(--foreground) 7%)` over an opaque `var(--background)` base. Light: `var(--card-bg)`, which is white. |
| Inner top highlight | plates | `inset 0 1px 0 color-mix(in oklab, var(--foreground) 9%, transparent)` |
| Long soft shadow | card | `var(--shadow-elevation-4), 0 48px 90px -30px color-mix(in oklab, var(--background) 78%, transparent)`. Light: the same, from `--foreground` at 18 %, larger and softer. |
| Kind index rule | card top edge, 2 px | `linear-gradient(90deg, var(--r2b-tone), color-mix(… 35%, transparent) 45%, transparent 85%)` |
| Head wash | card head | `linear-gradient(180deg, color-mix(in oklab, var(--r2b-tone) 6%, transparent), transparent 180px)` |
| Recessed rail | ledger rail | well = `background 97% + foreground 3%`, plus `inset 1px 0 0 rule` and `inset 14px 0 22px -18px shade` |
| Hairline rules | everywhere | `color-mix(in oklab, var(--foreground) 9%/17%, transparent)` |
| Segmented control | strip | a sunk well (`inset` ring and shadow) with a raised key-cap plate that slides between segments (framer `layoutId`). The plate's underline is the segment's lamp tone. |
| Instrument meters | Score row | 10 machined cells (lit: tone gradient and a soft glow; unlit: a 10 % ink well) over a tick scale drawn with two repeating gradients |
| Depth stack | under the card | 2 ghost plates (scale .965/.93, y 12/24, opacity .75/.4, blur .6 px). They rise one step on every walk or verdict, and the remaining count rides the stack edge. |
| Inverted control | Triage all | ink plate (`var(--foreground)`) with a paper figure (`var(--background)`). It is the one dark-on-light object in the bar. |

The kind tones are `CHIP_TONE` in `deckMeta.ts`: gates = `--status-warning`, proposals =
`--role-agent`, backlog = `--primary`, incidents = `--status-error`, council =
`--status-info`, reports = `--role-external`, chat = `--role-human`, ready =
`--status-success`. The strip itself stays monochrome.

## Icon vs text, per level

- **Strip.** Each segment shows a glyph, then the count as a figure, then the label in small caps (the label drops to a tooltip at 1280). The lamp lights only for held (amber) and critical or blocking (red); P2's row of cyan "waiting" dots is gone. Failed shows ⚠ in place of the figure, never a 0. Zero keeps its place in quiet ink.
- **Peek.** The head is the count as a 38 px figure next to the kind. Each row keeps its title as text and wraps to two lines rather than truncating. The source is a monogram plus its name, the age is a clock plus the elapsed time, and the right-hand column shows the cost as a figure over its unit. The word "Blocking" is gone; the tier is the stripe. Keys appear only on the focused row, once each, beside their verbs. The footer legend is gone.
- **Deck head.** A kind tile and the kind word appear once; the chip name is the tray's scope label. Tier and severity are a lamp with a tooltip. The severity word appears only on incidents ("Critical"). The alert pill is gone: its detail is the consequence sentence.
- **Consequence.** One rule-separated row, `IF YOU <VERB>` in small caps, then one sentence. No key appears in it.
- **Ledger rail.** The source is a monogram seal with its name, followed by two read-outs: a clock with the waiting time and a gauge with the cost. Their labels are in tooltips. Tags are capped at 2, shown as text with a tone dot, with no border or fill. Severity and score tags are dropped because the lamp and the meters already say them.
- **Body.** Labels hang in the margin: CASE, ANSWERS, SCORE (meters side by side), RECORD (plain facts as label-over-figure read-outs with a glyph where the concept is universal: repeat = occurrences, clock = first seen), WHY, EVIDENCE.
- **Dock.** Yes is the one solid control on the card. No is outlined in the error tone. Branches are hairline rows with a digit key. Later is quiet. Each key appears exactly once, set into its button.
- **Keys.** The legend bar is gone. A quiet "Keys ?" in the card corner, or the `?` key, opens a compact map of this card's keys. Esc closes the map first.

## The 5-second answers

| Level | Question | Answer |
|---|---|---|
| Strip | How many, of what kind? | 8 large figures in one control, each with its glyph (and small-caps label at 1920), and Triage all with the total as a figure. |
| Strip | Most urgent? | The segment holding the roster's first item takes the raised plate. Its figure and glyph turn its lamp's tone, and its lamp breathes. |
| Peek | Which first, what does it cost? | Rows come in roster order with the tier stripe at the edge. The cost column at the right reads `1 KEY`, `2 ANSWERS`, `3 EFFORT`, `1 MIN READ`. |
| Modal | What is asked? | The title, at 24.5 px and balanced. |
| Modal | What does yes do? | The `IF YOU APPROVE` row directly under the title. The alert detail wins, in the alert's tone. |
| Modal | Which key? | It is set into the solid green verdict button, and nowhere else. |

## What changed vs P2

- The strip became one continuous segmented control with a sliding plate. Counts became the hero figures, waiting lamps were removed, and Triage all is an inverted ink plate.
- The peek gained a figure head, hairline rows, two-line titles, a right-aligned cost column and focused-row keys. The footer legend was removed.
- The legend bar under the deck was removed and replaced by a corner `Keys ?` button and a `?` overlay. The new `?` key is added to the grammar; Esc closes the overlay first.
- The keys in the consequence band were removed, and so were the tier pill, the alert pill and the chip word in the eyebrow.
- The card gained material: a plate, a top highlight, the kind index rule, a head wash and a long shadow. The ghost stack is visible, rises one step on each walk or verdict, and carries a "N more in this deck" count.
- The tray head shows the position as a figure (`01 / 08`) and a ruler of tier-coloured ticks instead of dots.
- Body: the hanging-label grid. Scored facts (as meters) and plain facts (as read-outs) moved from the cramped rail into the body's Score and Record rows. Reader cards keep both in the rail, because their body is the document. This fixes P2's half-empty body next to a crowded rail, and the truncated "Confiden…".
- Meters went from dot rows to segmented instrument cells over a tick scale, with the reading as a figure.
- Verdict: a 150 ms machined stamp (glyph plus verb, no rotation) holds for 210 ms. Accept leaves up and right at +4°, reject down and left at −4°, and skip slides under the stack. The tray morph is now a 300/30 spring.
- Armed verdicts pulse an outline (static under reduced motion) and read "↵ confirm".
- Light theme: white `--card-bg` plates over an opaque base, larger lower-opacity shadows, and a light "N more" count on the scrim.

Behaviour that was kept, and verified by driving it in headless Chromium in both normal and reduced motion: 28/28 checks, 0 console errors. The checks cover walk ←/→, `?` and Esc, R arm → Esc disarm, R R → reason digit, A, S, branch, Esc back to the peek and to the strip, peek A in place, peek Enter, council arm + ↵, report ⇧4 + D, chat Space / typing guard / Enter send, the failed and zero strip, and Triage all.

## Screenshots

`<entry>-<W>x<H>-<theme>.png` for `strip`, `strip-failed-zero`, `peek-gates`, `peek-ready`,
`modal-approval`, `modal-approval-r1`, `modal-backlog`, `modal-report` (council),
`modal-report-rep1` (markdown), `modal-report-rep2` (HTML), and `modal-chat`, each at 1280x800 and
1920x1080 in dark-midnight and light. They use P2's tape (the fixture clock).

```
node scripts/style/shoot.mjs --module decision-center/prototype --tape docs/design/decision-center/p2/tape.json --port 1451 --kit r2b:<entry> --out docs/design/decision-center/r2b --label <entry-with-dashes> --sizes 1280x800,1920x1080 --themes dark-midnight,light
```

There are two harness-only kits, both read by this direction's Hub. `r2b:modal:<type>:<sourceId>`
opens a specific card. `r2b:strip:failed-zero` shows the council source as failed and Ready at
zero; the Lab falls back to the strip entry.

## With one more day

- At 1280x800 the reader cards' rail scrolls under the dock (council: coverage, members and contents). The fix is a collapsible rail section, or moving Contents into the reader's sticky bar as a section picker.
- Give the ledger rail more to do on short approval cards (it has air under the tags). A "recent verdicts on this source" sparkline would earn the space.
- Strip label mode fits 1592 px with about 10 px to spare. A real CommandBar needs a third tier (glyph and figure only, no padding change) measured the same way.
- An odometer for the tray's position figure. For now only the strip's counts roll.
- Make the stamp land on the verdict button's position, and travel from there, so the eye follows the key that was pressed.
