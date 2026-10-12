# R2-A — Obsidian Glass

Refine round 2, variant A, on top of P2 "Deck & Ledger". The structure, data, key grammar and
behaviour are P2's and unchanged. Code: `src/features/decision-center/prototype/directions/r2a/`.

## The visual idea

The deck is a stack of frosted dark glass on a vignetted floor. Each card is lit by its own kind:
the kind glyph sits in a tinted tile that throws a soft tone light across the card head, and a
gradient hairline in the same tone runs brightest at the top-left. Everything the user does not
need to read is pushed back into one recessed ledger well that runs the full height of the card,
so the only things that stand forward are the ask, its consequence and the lit verdict button.

## Material recipe

All of it lives in `r2a.css`. Every colour is a theme token or a `color-mix()` over one, and the file
holds no hex or rgb literals. Light themes rebind the same variables as frosted paper.

| Technique | Where | Expression |
|---|---|---|
| Layered card surface | `.r2a-card` | base `color-mix(in oklab, color-mix(in oklab, var(--background) 94%, var(--tone) 6%) 92%, transparent)` + `backdrop-filter: blur(24px) saturate(1.35)` + a 3 % foreground top sheen + inner top highlight `inset 0 1px 0 color-mix(in oklab, var(--foreground) 10%, transparent)` + `var(--shadow-elevation-4)` + long shadow `0 48px 96px -32px color-mix(in oklab, var(--background) 80%, transparent)` |
| Gradient hairline | `.r2a-hairline::before` | 1 px padding ring, `linear-gradient(140deg, tone 75 % → tone 30 % → hair → 4 % → tone 18 %)`, cut out with `mask-composite: exclude` (the mask source is `var(--foreground)`, used for alpha only) |
| Ambient tone light | `.r2a-card` first layer + `.r2a-aura` | `radial-gradient(70% 55% at 0% 0%, color-mix(in oklab, var(--tone) 15%, transparent), transparent 70%)` on the card, and a 48 px-blurred aura (tone at 30 %) behind the tray. The aura crossfades when the kind changes on a walk. |
| Vignetted floor | `.r2a-vignette` | click-through, `radial-gradient(ellipse 70vw 70vh at center, transparent 35%, color-mix(in oklab, var(--background) 60%, transparent))` over BaseModal's blurred backdrop |
| Recessed well | `.r2a-well` (ledger, composer, evidence, strip rail) | `color-mix(in oklab, var(--background) 26%, transparent)` + `inset 0 1px 3px` ink shadow + 1 px inner hair ring |
| Kind tile | `.r2a-tile` | radial tone fill at 34 % → 10 %, inner tone ring, outer tone glow `0 8px 24px -8px` |
| Arc gauge | `ArcGauge` | 270° SVG arc, `stroke: var(--say)` with a drop-shadow glow, value as the hero |
| Capsule meter | `ScoreMeter` | 10 cells in a recessed capsule, lit cells use a tone gradient with a glow. `bandTone` makes low effort and low risk good. |
| Ghost stack | `DeckTray` | up to 2 ghosts at scale .965 / .93, y 14 / 28, blur .6 / 1 px, opacity .75 / .45. They re-rise one step on every walk. A glass tab under the stack shows "N more under this one". |
| Raised lens | `.r2a-chip[data-lens]` | lamp-tinted gradient slab with an inner ring, lamp underglow and `shadow-elevation-2`. Its lamp breathes on a 2.8 s cycle and is static under reduced motion. |
| Lit verdict | `.r2a-verdict[data-look=yes]` | solid tone gradient, text in `var(--background)` (`var(--card-bg)` in light), tone underglow, key cap inset |
| Hover | `.r2a-btn` | 1 px lift and a 600 ms highlight sweep (`::after` gradient), with no scale. Neither runs under reduced motion. |
| Light theme | `[data-theme^="light"] .r2a` | ink becomes `--foreground`, glow drops to 7 %, the card is `linear-gradient(var(--card-bg)) over var(--background)` (paper white), shadows are larger and softer at 32 % |

Skipped: the grain. On the blurred dark glass it added mud, not material.

## Icon vs text, per level

- **Strip.** Each chip shows a kind glyph in its tone, a lamp and the count. The count is the hero
  (`typo-heading`) and the label stays `typo-caption`. Labels drop to tooltips when the bar is
  narrow, as in P2. Severity reads from the lamp and the raised lens, never from a word.
- **Peek.**
  - Words: the title (up to two lines, never cut to one) and the source name.
  - Icon + value: age (clock) and cost (gauge).
  - Tier is a glowing stripe, not a "Blocking" word.
  - The focused row carries its keys as inset caps with a ✓ or ✕ glyph. The footer keeps only
    ↑↓ and Esc, because every other key is already on the row.
- **Modal head.**
  - The kind is a glyph tile. The kind word appears once, in the eyebrow.
  - The tier is a lamp, and its tooltip carries the alert label ("Holding a team step"), which
    used to be a pill.
  - Severity is a word only on incidents ("Critical"), where it is the subject of the decision.
  - The consequence is one sentence with no key.
- **Ledger.**
  - Universal facts are an icon plus a tabular value, with the label in a `Tooltip` and sr-only:
    waiting (clock), cost (gauge), project (folder), occurrences (repeat), persona (user).
  - Item-specific facts keep their words ("Action: pause_schedule", "Saves: $1.20 / day").
  - At most two tags, as small caps with a tone dot. A tag is dropped when it repeats the source
    or the severity.
  - A lone score is an arc gauge. Several scores are capsule meters.
  - Chat participants are an avatar stack with name tooltips.
- **Dock.**
  - Verbs are text, with the key inset inside the button. That is the only place a key is printed.
  - The full map is behind the "⌨ ?" affordance in the tray head (also the `?` key). Esc closes it
    first.
  - Walk and close are icon buttons with tooltips.
  - P2's separate legend bar is gone.

## The 5-second answers

| Level | Question | Answer |
|---|---|---|
| Strip | How many? | Tabular count on every chip; **Triage all [16]** carries the total in an inset numeral. |
| Strip | What kind? | Kind glyph in its own tone (gates cyan, proposals violet, backlog amber, incidents red, council blue, reports sky, chat pink, ready green), plus the label when there is room. |
| Strip | Most urgent? | The one raised lens, lit red from below with a breathing lamp. Failed chips show ⚠ on a dashed red ring, never 0. Zero chips stay in place and dim. |
| Peek | Which first, what cost? | Roster order. The glowing tier stripe and "Next" mark the queue head, and the gauge icon + cost ends each meta line. |
| Modal | What is asked? | The title in two balanced lines, next to the lit kind tile. |
| Modal | What does yes do? | The tone-ruled line `↳ If you approve — <one sentence>`, in the alert's tone when it has one. |
| Modal | Which key? | Inset in the lit verdict button (`Approve [A]`), and in each branch (`[1]`, `[2]`). |

## What changed vs P2

- One flat slab became layered frosted glass with kind-tone light, a gradient hairline, a long
  shadow and a vignetted floor.
- The ledger became a full-height recessed well beside head + body. The rail is no longer cramped
  while the body sits half empty, and the card is 1040 px wide instead of 1120.
- Pills are gone:
  - The tier pill became a lamp, the alert pill a lamp tooltip, and the severity pill a lamp.
  - Severity is a word only on incidents.
  - Tags are capped at 2, as small caps with a dot, without the duplicates.
- Keys are printed once. Gone: the key in the consequence band, the legend bar and the peek footer
  verbs. Added: the "⌨ ?" overlay and the `?` key.
- Ledger labels became icon + value with tooltips. "Confiden…" is no longer truncated: it is an arc
  gauge with the full word. Contents entries wrap instead of truncating.
- Dot-row meters became an arc gauge (a single score) and tone-gradient capsule bars (several).
- The strip is a recessed glass rail with a raised-lens head chip, tone glyphs and hero counts. The
  Triage all count is an inset numeral.
- The ghost stack has real depth (scale, blur, opacity), re-rises one step on each walk, and the
  remaining count rides its edge.
- Motion:
  - The stamp is a glass medallion (glyph + verb) that lands in 150 ms.
  - Accept leaves up and right at +4°, reject down and left at −4°, and skip slides under the stack.
  - The open morph is a 300/30 spring.
- Deep links `?kit=r2a:modal:<type>:<sourceId>`, plus a new `?kit=r2a:strip-states` (council failed,
  Ready at zero).

## Before / after verdict (P2 PNG next to R2-A PNG, same entry, size and theme)

| Entry | Verdict |
|---|---|
| `strip` | **Better.** The head chip now pulls the eye (a raised lens with underglow), and kinds are told apart by tone without labels at 1280. Counts read as numerals rather than as text. |
| `strip-states` (P2 `strip-failed-zero`) | **Better, slightly.** Same honesty: failed chips show ⚠ on a dashed ring, zero chips dim. The failed state is easier to spot inside the well. |
| `peek-gates` | **Better.** The tier reads from the glow alone, so the "Blocking ·" words are gone. Titles are never ellipsised to one line, and costs carry icons. The keys are on the focused row instead of a footer sentence. |
| `peek-ready` | **Better, slightly.** Same content on the glass material with green tone tiles. Dispatch is unchanged. |
| `modal-approval` / `-r1` | **Clearly better.** The card is now an object: lit tile, hairline, depth. The ask and its consequence lead, and the yes key sits once in a lit button. The ledger is a calm well, and confidence is a readable gauge rather than a truncated label. |
| `modal-backlog` | **Better.** Effort, impact and risk are capsule meters with good/fair words, and the evidence sits in a recessed well. The tags dropped from 2 pills to 2 small-caps words. |
| `modal-report` (council), `-rep1`, `-rep2` | **Better.** A glass progress bar with a tone glow, and wrapping contents with an active rule. The council's arm/confirm note is plain prose instead of a key list. |
| `modal-chat` | **Better.** The bubbles are glass, the ask glows amber with a small-caps "The ask", and the composer is a recessed well with Send [↵]. Participants are an avatar stack. |

## Verification

- `npx vitest run src/features/decision-center/prototype/directions/r2a`: 3 passed. They cover the
  full grammar (strip → peek → deck → walk → A → R R → R R + digit → queue empties to the peek →
  Esc), the Esc ladder with the key map in front, keys printed once, and the composer typing guard.
- I drove the whole grammar in the harness under `reducedMotion: 'reduce'` with Playwright: no
  console errors, and the Esc ladder runs reason prompt → deck → peek → strip.
- Screenshots: every `*-report.json` here is `ok: true`.

```
node scripts/style/shoot.mjs --module decision-center/prototype --tape docs/design/decision-center/p2/tape.json --port 1441 --kit r2a:<entry> --out docs/design/decision-center/r2a --label <entry-with-dashes> --sizes 1280x800,1920x1080 --themes dark-midnight,light
```

Entries: `strip`, `strip-states`, `peek:gates`, `peek:ready`, `modal:approval`,
`modal:approval:r1`, `modal:backlog`, `modal:report`, `modal:report:rep1`, `modal:report:rep2` and
`modal:chat`. I used P2's tape (fixture clock 2026-10-06T14:00Z) so that ages read honestly.

## With one more day

- Tune the light theme on true paper: the harness's default brightness filter greys the whole
  frame, so the glass-on-paper contrast is under-sold in these shots.
- Size the deck by content. A short approval still leaves acreage under the body. A measured card
  height, held constant across one deck session, would end it without heights jumping on a walk.
- Compact strip at 1280: test a 2-letter tone caption under each glyph, so "what kind" reads
  without colour or hover.
- Morph the open from the chip with a real shared `layoutId` backplate, rather than the
  origin-scale morph inherited from P2.
- Cost and effort repeat on backlog cards (the gauge tile and the Effort meter). Show the project
  in the tile instead.
