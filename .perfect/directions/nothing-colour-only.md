---
slug: nothing-colour-only
type: perfect/direction
context: "[[agents-quick-answer]]"
lens: ux
status: shipped
size: M
proposed: 2026-08-05
accepted: 2026-08-05
shipped: 2026-08-05
commit: a8b098a28, f9a58d70d
---
## What & why

Two of the facts a reviewer weighs before deciding are legible only if you can see colour,
and the deck's announcements go silent exactly when they repeat. This is a decision surface;
being unable to read a risk flag is not a cosmetic problem.

## Evidence

- `TriageFactRow.tsx:55-58` — a fact's `tone` renders as `TONE_TEXT[fact.tone]` and nothing
  else. No icon, no qualifier, no `aria-label`.
- `MetricBadgeRow.tsx:19-34` — `bandTone(value, max, invert)` paints border/number/fill. The
  number is text, but good-vs-bad (the entire purpose of `invert`, `DeckChips.tsx:119-126`)
  is colour only; the meter is `aria-hidden` (`:29`).
- `DeckQueueRail.tsx:117-119` — the deferred marker is a bare `aria-hidden` glyph. The row's
  KIND got an `sr-only` companion in the same file (`:107`); this state did not.
- `TriageDeckVariant.tsx:125-127` hand-rolls the polite region. Identical consecutive strings
  produce no DOM mutation and are not re-spoken. `AriaLiveProvider.tsx:33-50` exists
  precisely to force per-message utterance via a `key` bump.
- The "ONE live region" claim (`TriageDeckVariant.tsx:122-124`, `TriageCard.tsx:204-211`) is
  false: `AlertBanner` carries `role="status"` per card, up to 3 mounted
  (`TriageCardHeader.tsx:36,99`), and `LoadingSpinner.tsx:12-21` adds another.
- `TriageCardBody.tsx:66` sets `tabIndex={0}` unconditionally; `TriageCard.tsx:201` renders it
  for all 3 stacked cards → 3 tab stops, 2 behind `pointer-events-none` (which does not
  remove tab order). Existing tests render a single item and cannot catch it.

## Acceptance criteria

- [ ] A tone-bearing fact carries a non-colour signal (glyph and/or text).
- [ ] Meter direction is readable without colour and reachable by a screen reader.
- [ ] The rail's deferred state has an `sr-only` companion.
- [ ] The deck announces through `AriaLiveProvider`, and two identical consecutive verdicts
      each produce an utterance.
- [ ] Only the top card's scroller is a tab stop.
- [ ] The "ONE live region" comments become true, or they go.

## Risks / non-goals

Not a visual redesign — the existing tone palette stays. Do not regress the focus trap or
restore-to-trigger behaviour asserted in `deckDialog.test.tsx`.

## Build record

**Shipped** `a8b098a28`, then **REDO** → `f9a58d70d`. Director verdict: **redo with notes**,
then merge.

### First pass — 5 of 6 good

One shared `toneReading` in `DeckChips.tsx` gives fact tone and metric band a glyph + word;
rail deferred state got its `sr-only` companion; `tabIndex={isTop ? 0 : -1}`; announcements
moved to `AriaLiveProvider` with `lastVerdict` as a **stamp**, so two identical consecutive
verdicts are two events (keyed on the string, `Object.is` collapses them — negative-checked).
Palette untouched: signal added, not substituted.

### The redo — an accessibility regression inside an accessibility direction

Removing `role="status"` from `AlertBanner` was correct (three mounted cards = three polite
regions announcing banners for cards nobody is deciding). But the review found the fact then
went **nowhere**: `triage_announce_card` carried only kind + title, and no live region held
the alert. `TriageAlert` is documented as *"the ONE fact that changes what the decision
MEANS"* — the example being a review that is BLOCKING A HELD TEAM STEP — and the deck is
keyboard-first, so a screen-reader user could rule on blocked work having heard only a title.

Fixed by folding the alert into the card-dealt utterance through a **composition key**:

```
triage_announce_card_alert = "{card}. Flagged: {alert}."
```

Chosen over widening `triage_announce_card` with an optional slot for two reasons that
generalise: a card with no alert renders byte-identical to before (no dangling separator in
14 locales), and **the locale owns the join punctuation** — `{card}。注意: {alert}。` (ja),
`{card}। चिह्नित: {alert}।` (hi/bn), thin-space colon (fr). A hardcoded `". "` in the
component would have been wrong in five locales.

Label only, not detail — asserted, not merely intended. Alert appended rather than leading,
because the verdict utterance precedes the deal utterance and a leading flag reads as
belonging to the card just decided.

Gates: 262 tests / 16 files · tsc 0 · eslint 0 errors · both i18n gates green (5 + 1 keys ×
14 locales).

### Lesson recorded in DESIGN.md

Taking a live region off something load-bearing obliges you to say where it is announced
instead.
