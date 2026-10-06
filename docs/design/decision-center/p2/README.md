# P2 — Deck & Ledger

Prototype direction P2 of the Decision Center spark: the evolution of the app's own
triage lineage. Code: `src/features/decision-center/prototype/directions/p2/`.

## The idea

Every decision is a **card on a deck**. The cards slide with TriageFocus's 300 px spring
(the `triageFocusMotion` numbers, reused), and the deck now grows out of the chip or row
that opened it and leaves on a verdict. Every card of every type carries **the same ledger
rail**, generalised from `BacklogDetailLedger`: who raised it, how long it has waited, what
it costs, its tags, scored facts as meters, a type section (contents for a report, people
for a chat) and, at its foot, **the dock**: every action the card supports, each with its key.

## The 5-second first-sight test

| Level | Question | Where the answer is |
|---|---|---|
| Strip | How many need me, and of what kind? | Seven chips in a fixed order (Gates, Proposals, Backlog, Incidents, Council, Reports, Chat), then Ready. Each chip shows an icon and a count, plus a label when there is room. **Triage all N** gives the total. |
| Strip | Which one is most urgent? | The chip that holds the roster's first item (`compareDecision` order) is tinted and underlined. It shows Incidents in the fixture, with a red lamp for the critical item. Lamps: red is critical or blocking, amber is held, blue is waiting. A chip at zero stays in place and is dimmed. A chip whose source failed shows a ⚠ with a dashed red border, never a 0 (`strip-failed-zero-*`). |
| Peek | Which item first, and what does it cost? | Rows come in roster order. The left stripe shows the tier: red is blocking, blue is decide, grey is read. Blocking rows say **Blocking** in red. Each meta line ends with the cost in the item's own unit: `1 key`, `2 answers`, `effort 3`, `1 min read`, `reply`. The focused row shows its keys (`A R ↵`, or `D ↵` for reads). |
| Modal | What is being asked? | The title, in the card head. Above it are the chip, the kind and a tier pill. |
| Modal | What happens if I say yes? | The tinted **If you approve / resolve / accept / reply / mark it done** band directly under the title. The item's own alert wins (for example, *Approving resumes step 4 of the Growth pipeline, paused for 26h.*). |
| Modal | Which key? | Printed at the end of that band (`A`, `A ↵` for council, `D`, `Space`), on every dock button, and in the legend under the deck. The legend uses the card's own verbs. |

Width honesty: the strip measures itself. It keeps labels while they fit beside the 440 px
stand-in (1920 px window) and drops to icon + lamp + count, with the label in a tooltip,
when they do not (1280 px window, where the harness main column is 952 px). In both cases
the row never wraps.

## Key map (implemented exactly as decided)

| Key | Peek | Deck |
|---|---|---|
| ↑ / ↓ | move focus | scroll the body / reader |
| ← / → (also K / J) | — | walk the queue: the chip's items, or the whole roster in Triage all |
| Enter | open the deck on the row | confirm what is armed |
| A | approve / accept the row (ready: dispatch) | accept. Council: arm, then Enter. Question: submits all answers as one batch and flags empty fields. |
| R | reject the row | arm reject. A second R or Enter confirms. A reason prompt may follow: digits pick an option, Enter skips, free text is optional. Council send-back needs at least 12 characters. |
| S | — | skip (Later). The card slides under the deck. |
| D | done (reports, chat) | done / mark read |
| Space | — | focus the chat composer (Enter sends, Shift+Enter is a newline) |
| 1-9 | — | branches (Build now, Follow up in chat, …), or reason options while a prompt is open |
| Shift+1-5 | — | rate a report |
| Esc | close the peek | undo what is armed or prompted first, then step back: deck → the peek it came from → strip |

Letters never fire while focus is in the composer, a reason field or a question input. Esc
has ONE owner, BaseModal: its `onClose` asks the deck to disarm before it steps back, so
this works with or without an `AppKeyboardProvider` (the page harness has none). The peek
registers at 70 and the deck at 85, both named constants in `keys.ts`.

## Motion

- **Origin morph**: the deck tray starts at the opening element's centre and scale (a chip, a
  peek row, or Triage all) and grows to centre in `MOTION.duration.normal`. On close it shrinks
  back toward that origin.
- **Walk**: `CARD_VARIANTS` + `CARD_SPRING` from `triageFocusMotion.ts`, direction-aware.
  Leaving to the left means you went forward.
- **Leave on verdict**: the card is **stamped** first (`Approve ✓`, `Reject ✕`, `Read ✓`,
  `Sent ✓`, spring-slammed in), and after a 170 ms beat it leaves toward the verdict's
  meaning. Approve flies up and right, reject drops away, done files upward, skip sinks under
  the deck. The next card rises off the stack. Ghost cards under the top card show how deep
  the queue is, and the pips in the tray mark tier and position.
- **Peek**: an anchored drop with a row stagger. Decided rows slide out toward their verdict.
  Chip counts roll up or down when they change.
- **Reduced motion**: the morph, slide, stamp and leave all collapse to short cross-fades.
  The verdict commits at once, with no stamp beat. Verified by driving the full grammar
  under `reducedMotion: 'reduce'`, with no console errors.

## Reading surface (reports, council)

One heading-id assigner per document (`readerDocument.ts`) feeds both the contents list and
the rendered headings. There is one chrome offset (`READER_CHROME_OFFSET`, the sticky
progress bar) for jumps and for the reading band. The current section is the topmost heading
inside the band. It is measured in layout offsets, never transformed rects, so a sliding
card cannot confuse it. When no heading is inside the band, the previous answer stands.
Progress is shown as a locale percent. The decision dock sits in the rail and stays
reachable however far you read. To reach the HTML report, walk → from the markdown one:
`modal:report` opens the Reading queue (council → rep1 → rep2).

## Screenshots

`<entry>-<W>x<H>-<theme>.png` for `strip`, `peek-gates`, `peek-ready`, `modal-approval`,
`modal-backlog`, `modal-report`, `modal-chat` at 1280x800 and 1920x1080, in both dark-midnight
and light. There are also extra shots:

- `modal-approval-r1`: the review with its alert, branches and reason prompt.
- `modal-report-rep1` and `modal-report-rep2`: the markdown report and the HTML report.
- `strip-failed-zero`: the council source failed, and Ready is at zero after Dispatch all.

The extras come from a harness-only deep link that P2's Hub reads itself:
`--kit p2:modal:<type>:<sourceId>`.

The shots use `tape.json` in this folder. It is the synthetic tape with `recordedAt` moved
to the fixture clock (`2026-10-06T14:00Z`). The stock synthetic tape is dated 2026-09-22, so
every fixture age would render as "now".

```
node scripts/style/shoot.mjs --module decision-center/prototype --tape docs/design/decision-center/p2/tape.json --port 1451 --kit p2:<entry> --out docs/design/decision-center/p2 --label <entry-with-dashes> --sizes 1280x800,1920x1080 --themes dark-midnight,light
```

## With one more day

- Compact strip at 1280: test a two-letter label under each icon, or a hover-expand of the
  whole row, so "of what kind" reads without tooltips.
- Undo: a toast-free "Z undo" for the last verdict while its card is still in flight on the
  done pile.
- Promote the type section of the rail into a proper per-type slot contract, so new kinds
  (an incident timeline, a council member grid) plug in without touching `DeckCard`.
- Measure the exit spring. TriageFocus's 300/30 takes about 600 ms to fully settle on a
  300 px travel. That is fine for walking, but the rapid-fire verdict case may want a stiffer
  spring.
- Light theme: give the card a raised surface token so it separates from the dimmed page
  more clearly.
