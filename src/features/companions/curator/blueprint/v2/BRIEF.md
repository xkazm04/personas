# Blueprint v2 - her plan beside the operator's queue

This is a **prototype round built directly in the app**, not a standalone page. The last round
was won as an HTML prototype and ported, and the operator's verdict on the port was that it
"took color theme and tones but rest was not performed carefully". Building natively is the
fix: there is no port, so there is nothing to lose in one.

## The idea

Curator keeps a knowledge registry world-class and applied. Her page has to do two jobs at once
and today does only the first:

1. **Her plan** - what she would do next, projected from the registry's own instruments.
2. **The operator's queue** - what he has asked her to do, in the order he asked.

The operator's own words for what he needs:

> "Redesign the main table structure so it displays two columns (each half of the width). First
> for Curator plan similarly to now, but with migrated key marks or measure if exist instead of
> the column structure. Second column for human queued tasks to display (name of the skill, name
> of the target). This approach will be convenient for passing large numbers of intakes from my
> side and overview its state."

So the surface is **two half-width columns**, and the right-hand one is the one he will actually
work in. He files intakes in bulk - a URL and a note at a time, many at a sitting - and he needs
to see, at a glance, what he has queued and where each one has got to.

## What changes on the left, and it is a real design question

Today the plan is a nine-column grid: one column per reason the registry's scan can score, each
a thin icon-headed channel. **At half width that grid does not fit** - and the operator's
instruction is not "make it narrower" but "migrated key marks or measure if exist instead of the
column structure". So: carry the *meaning* of those nine channels into something that reads at
half width. A mark, a measure, a compressed signature, a sparkline of the nine, a dominant-reason
glyph with the rest on demand - yours to decide. The nine reasons are a closed vocabulary and a
reason must stay readable **as itself**, never flattened into "weak".

## What the right column carries

Per queued item, at minimum: **the skill** and **the target**. Beyond that, state - because the
point is overview. The states are `queued | dispatched | landed | declined | failed | cancelled`.

The operator raises one more idea, and it is worth designing for even if it is not built here:

> "Consider designing pre-processing task for example with Sonnet Low - to extract topic name
> from resource, high level domain of impact."

A raw intake is a URL. A list of forty URLs is unreadable. A cheap model reading each resource
once and returning a **topic name** and a **high-level domain of impact** would make the column
scannable. Design the row for the enriched shape, and design what it looks like **before** the
enrichment has run - because that is a real state, not a loading shimmer, and it is the one the
operator sees the moment he pastes forty links.

## State must arrive, not be asked for

> "Changing states of queue items will be dynamically reflected in the UI, ideally listening
> events from Curator about success or another state. I would avoid polling."

**The event does not exist yet.** The pattern does: `src/lib/eventRegistry.ts` carries
`COMPANIONS_STATUS_CHANGED: 'companions://status-changed'`, and Rust commands publish through
that registry. Design for push, consume it through **one hook** so the day the event lands the
swap is one file and not thirty. Do not build a polling loop and call it temporary.

## The material, and its honest state

- `curator_request` - the operator's lane. **0 rows today.** Nothing has been filed yet.
- `curator_plan_run` / `curator_plan_item` - **0 rows today.** The instrument has never run, so
  there is no plan. A headless door to run it is being built in parallel; assume real rows soon,
  and design the empty state as a real state in the meantime.
- `curator_dispatch` - 25 rows. `curator_commit` - 25 rows, all `L0`, on `main`.
- The registry itself: 471 subjects, 10 bundles, 3,274 techniques, 1,825 applications, 268 rows
  queued in harvest's own queue. The real scan is at
  `src-tauri/src/commands/curator/fixtures/librarian-scan.json` (430 KB) if you want true shapes.
- Nine reasons, in scoring order: citation gone (6 each) - no application (6) - expired
  application (5 each) - consumer deviation (4 each) - fewer than 4 techniques (4) - never swept
  (3) - technique with no `use_when` (2 each) - single stack (2) - application near its clock (1
  each). **Three of them occur zero times in this corpus** (citation gone, expired, no use_when),
  and that is a measured zero, not an absence of data.

## The rule that outranks everything else here

**An unknown is never a zero.** A count, a measured zero, an unknown and an unmeasurable are
four different facts and must look like four different things. This page's whole argument is
that distinction, and every variant is judged on it before it is judged on anything else.

## Style - and this is the half the last round got wrong

**You are building in Personas. Compose like Personas.**

- Read `.claude/rules/ui.md`, `.claude/Design.md`, `src/features/shared/components/CATALOG.md`
  and **`docs/design/style-mastery/doctrine.md`** - the last is a decided campaign with a Gate 0
  verdict, and section 0b is how a module is revitalized. Rule 7: the headline is what the
  surface visibly does, not its token count.
- Import catalogued primitives. Do not hand-roll a button, an empty state, a tooltip, a select,
  a tab strip or a table shell. The existing page has **2,217 lines of bespoke CSS and 344 of
  its own classes** against **nine** shared-component imports; that ratio is the defect.
- Typography through the `typo-*` roles only. No raw `font-size`. No raw palette steps.
- The theme's primary tint and glow are identity, not decoration (doctrine rule 1) - the
  operator says the colour work is the part that went right.
- Remove redundancy rather than restyle it (rule 3).

A variant that reads as a foreign page wearing Personas' colours has failed the brief's main
point, whatever else it does.

## Hard constraints

- Works at **1000x640** (the app's content area on a 1280x800 window, after a 64px rail and a
  220px menu) and fills 1920x1080. At 1000x640 the previous page showed **zero of sixteen rows**;
  do not repeat that.
- Both themes: dark and `[data-theme^="light"]`.
- `prefers-reduced-motion` honoured.
- Components under 200 LOC.
- Every user-facing string through `t.section.key`. **Do not add i18n keys in this round** -
  three seats editing fourteen locale files would collide. Use the existing
  `companions.blueprint.*` keys where they fit and plain English placeholders where they do not,
  marked with `// i18n:` so the fusion pass can extract them.

## What you deliver

One variant, in **your own directory only**, exported as a default React component the switcher
already imports. Plus a `NOTES.md` beside it, under 300 words: `# <Concept name>`,
`## The one idea`, `## How the two columns divide`, `## What a queued intake looks like before
enrichment`, `## Known limits`.

## The bar

The operator reviews every variant himself and fuses the final design from named parts. Give him
**one clear, nameable idea** he can borrow. Three variants that differ only in spacing are one
variant. Draw the quantities; reserve words for the reason.
