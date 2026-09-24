# The Mirror (`experience_mirror`) — what it is and why

Third contest entry for "create a twin, then train it", 2026-09-24. Not a
research document: nothing new was researched. It is built on two things that
were already written down — the owner's verdict on the previous contest rounds,
and `.claude/Design.md`.

---

## 1. The brief it answers

The owner threw away six persona-onboarding variants on 2026-09-22 with this:

> significant degradation even from current state … overflowing components/text
> in one sight, lack of layering/story build up in the UX

and what he wanted instead:

> start simple with the one interaction in the centre, subtle reserved frames
> around it that fill with indicators and graphical abstractions, heavy choices
> and texts behind modals or nested pages, one act at a time.

The two sibling variants are both **tables**: a rail of slots on the left, a
question in the middle, panels on the right, a legend underneath. They are good
tables. They are also, structurally, the thing that verdict is about — every
feature is reachable from one sight, so every feature is *in* one sight.

The Mirror is the other answer. Same engine, same contract, same backend; the
question it asks is "what if the surface refuses to grow?".

---

## 2. The one rule

**The lane never grows.**

The centre of the screen is the same three things from the first turn to the
last: a question, up to three answers, one field. Nothing is ever added beside
them. Everything a competing surface would put in a column is a **door** in the
rail that opens a **layer** over the lane and closes again:

| What | Where it lives | Why not in the lane |
|---|---|---|
| What the twin knows | `layers/SheetLayer` | a readout, consulted rarely, read in full when it is |
| What to train on | `layers/DeckLayer` | a decision made once per round, not per turn |
| The voice studio | `layers/VoiceLayer` | a whole workflow of its own |
| Every field, typed | `layers/FieldsLayer` | the escape hatch, not the path |

A layer is a dialog in its own right and takes the keyboard **above** the shell
hosting it (`OVERLAY_DISMISS_PRIORITY` > `FULLSCREEN_LAYER_PRIORITY`), so
Escape closes the layer, not the experience.

Measured against the screenshot test the feedback note asks for: with no layer
open, the lane carries **well under 60 visible words** outside the question and
the answers themselves, and a full turn fits at 1280×800 without scrolling.

---

## 3. Reserved frames that fill

Three of them, and all three are drawn **before** they have anything in them —
which is the same thing loading pattern v2 asks for, arrived at from the other
direction:

- **The ring** (`stage/ProgressRing`). Four arcs around the twin's disc, one per
  setup slot, faint and empty on the first frame and drawing themselves in as
  slots complete. Progress is a shape changing, not a number changing. Colour
  comes from `twinStatus` — the one presentation table for these four slots —
  and the *fraction drawn* carries the same information for anyone who cannot
  separate the colours.
- **The question frame** (`stage/Ask`). It stays lit and stays the same size
  while the next question is written; only the text inside it changes. No
  spinner, and no reflow under the person's hands.
- **The three slats** (`stage/Answers`). On the first deal they are three empty
  dashed frames of exactly the geometry the real answers will take.

And one frame that fills and then empties itself: **the whisper**, a single line
that says what the last act changed (`Kept · biography`) and fades out. It is
how the lane keeps a running count without ever growing a panel.

---

## 4. The seam

The point of the variant is that creating and training are **one act**, not two
screens. `create/CreateAct` and `stage/StageRail` render the *same*
`SigilDisc` under one framer `layoutId`, inside one `LayoutGroup`, with the
presence in **sync** mode so both acts are mounted for the length of the
transition. The disc the person chose while naming their twin physically travels
up into the chrome and becomes the identity they are now training. Nothing is
torn down and rebuilt in front of them.

Under reduced motion the shared id is dropped and the disc simply appears where
it belongs. The Setup tab's launch card renders a third disc **without** the
shared flag on purpose: two live elements sharing one `layoutId` is undefined
behaviour, and that card is on screen at the same time as the layer above it.

---

## 5. Act one is one question

`create/CreateAct` opens on a disc, a sentence and a field — nothing else. The
sigil row and the way on do not exist until a name does; they fade up the moment
it is typed. The two things a create form asks next are a door, not a section:

- **the languages they write in** — new here, because every generator behind the
  twin reads them and the dialog this replaces never asked;
- **a starting voice** — recorded, never run. Running it needs the twin to exist,
  so the stage's voice layer takes the record exactly once (`useVoiceDock`).

`__tests__/CreateAct.test.tsx` asserts the layering as well as the contract: the
sigil row and Begin are **absent** before a name exists, and the ten preset
voices are **absent** from the lane until the door is opened. The taste rule is
a test, not a comment.

---

## 6. Personas style, held rather than decorated

- **Every colour is a token.** `--primary`, `--foreground`, `--background`,
  `--secondary`, `--status-*`. No decorative palette, so the
  `[data-brightness=…]` compensation is never bypassed and all ten themes carry
  it for free. The one decorative idea — the aurora on `.mr-field` — is
  `--primary` at low alpha.
- **Colour means status and nothing else.** Nothing on this surface is tinted to
  say what *kind* of thing it is.
- **Shared primitives, not copies.** `ChatInputBar`, `SetupProposalRow`,
  `SetupFieldsPage`, `SegmentedTabs`, `Numeric`, `Tooltip`, `AccessibleToggle`,
  `Button`/`AsyncButton`, and the whole style studio (`PresetGallery`,
  `RollCandidates`, `StyleDraftPreview`, `StyleNotice`, `PinsBar`) are used as
  they are.
- **Vocabulary is reused, not forked.** The slot labels, stage names, voice
  controls, proposal kinds and the six training topics all resolve through the
  app's existing keys (`twin.setup.*`, `twin.training.*`,
  `TRAINING_TOPIC_PRESETS`), so this variant adds 75 strings rather than 137 and
  cannot drift from the Training Room's own words.
- **Motion is a vocabulary of three moves** (`motion.ts`): a question rises, a
  slat arrives on a stagger, a layer slides from its edge. Each collapses to
  opacity under reduced motion; the only looping animation is the CSS whisper,
  which `mirror.css` stops under both `prefers-reduced-motion` and
  `[data-motion='reduce']`.

---

## 7. What was carried over from the siblings, deliberately

Two hard-won correctness rules were reproduced rather than re-learned, and they
are now unit-tested in `__tests__/useTurn.test.ts`:

1. **One verdict per question.** `busy` cannot be the guard — in the training
   stage the answer is recorded *before* the next turn is requested, so a second
   press still reads "not busy" and sends the same answer twice. The claim is
   keyed on the question. A generator failure releases it, because a failed turn
   keeps the same question on screen.
2. **A redeal is parked, never fired inline.** `setStage`/`setTopic` only change
   what the *next* question is about; a redeal fired in the same tick is dropped
   and the answer to the old turn lands on the new stage.

---

## 8. What is owed

- **Nobody has seen this run.** No live smoke, on any theme, at any width. The
  1280×800 claim in §2 is a measurement of the composed heights, not a
  screenshot.
- The shared-sigil transition is verified to *render* correctly (tests pass with
  it present) but its **animation** has never been watched.
- The translations are machine-produced, reviewed only for placeholder
  integrity and length, not read by a native speaker.
