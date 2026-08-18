---
layer: technique
subject: search
technique: command-surface
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Command surface

A command surface — the keyboard-summoned palette that finds commands,
destinations, and entities from a few typed characters — serves the
**navigate** intent: the user already knows what they want and is buying the
shortest path to it. That inverts most of search's priorities. Recall
matters less than the top hit being right; corpus honesty matters less than
speed; and ranking leans on *the user's own history* as hard as on the text,
because the strongest predictor of what this user means by "dep" is what
they picked for "dep" yesterday.

## The contract: summon, type, enter

The whole surface is an interaction loop measured in hundreds of
milliseconds: a global keystroke summons it with focus already in the input;
each character narrows a visible list; arrow keys move a selection that
starts on the first item; enter executes the selection; escape leaves
everything exactly as it was. Three properties are load-bearing:

- **Enter executes the top hit**, so the top hit must be *predictable* — the
  experienced user types three characters and hits enter blind. Every
  ranking decision below serves this blind-enter contract.
- **Latency is local-tier.** The candidate corpus (commands, destinations,
  recently touched entities) is small enough to hold in memory and match
  synchronously per keystroke; a palette that debounces or spins has already
  failed its intent. Providers that must be asynchronous (cross-corpus
  entity search) append labeled sections below the synchronous results —
  they never delay or reshuffle the instant tier, and never steal the
  selection from under the user.
- **Escape is free.** Summoning the palette must be risk-free to the state
  beneath it, or users stop reaching for it reflexively — and reflexive use
  is the entire value.

## One registry

The palette's corpus of commands is the same registry the rest of the
application executes from — menus, buttons, shortcut bindings — not a
hand-maintained parallel list (one-authority-per-vocabulary). The parallel
list fails on schedule: a feature ships, its command misses the palette, and
the users who miss it are precisely the keyboard-first users the palette
exists for. Each entry carries its identity (stable across renames — pinned
items and usage history hang off it; identity-survives-reuse), its
user-facing label phrased as a verb ("Create project", not "Project
creation"), its enablement predicate, and its scope (global, or bound to a
context that must be active). Disabled-in-context commands are better shown
disabled with the reason than hidden — a palette that silently omits teaches
users it is unreliable, which breaks blind trust in the whole surface.

## Fuzzy matching with weighted scoring

Palette matching is subsequence matching — every typed character appears in
the candidate, in order, not necessarily adjacent — scored so that the
*shape* of the match ranks intuitively:

- **Boundary hits outrank interior hits.** Characters matching at word
  starts (and at case humps in compound identifiers) score far above
  characters buried mid-word; this is what makes abbreviation typing work —
  the initials of a three-word command should beat an interior substring of
  an unrelated one.
- **Consecutive runs outrank scattered hits.** A contiguous block of matched
  characters is stronger evidence of intent than the same characters spread
  thin; gaps carry a penalty that grows with distance.
- **Earlier and denser beats later and diluted.** A match starting at the
  first character, and a match covering most of a short label, both earn
  bonuses — exact prefix of a short label is the strongest match there is.
- **The rejection threshold is real.** Below a floor score, a candidate does
  not appear at all. Subsequence matching with no floor "matches" almost
  everything at length three, and a palette full of noise costs more trust
  than an occasional miss.

A coarse **banded** scheme — exact match above prefix above substring above
subsequence-with-gap-penalty, as fixed score tiers — is a legitimate
simplification of the above when labels are short and the corpus is small; it
keeps the ranking predictable and trivially debuggable. What a banded scheme
gives up is discrimination *within* a band: many candidates tie at the same
tier, which makes an explicit tiebreak — the personal prior below, then
stable identity — load-bearing rather than theoretical. Sorting ties by
nothing leaves the order to the sort implementation and the accidental order
of the candidate list, and the blind-enter contract cannot rest on an
accident.

Case-fold and diacritic-fold before matching; the marks drawn on results
come from the matcher's own hit positions, not a re-search of the label.

## Recency and frequency: the personal prior

Text score alone ranks a rarely-used command with a slightly better match
above the destination the user opens forty times a day. The palette blends
in a personal prior — recently and frequently chosen items rise, with
recency decaying so last month's obsession does not shadow this week's:

- **Empty query shows the personal list**, not a blank pane: recent
  choices, then pinned or suggested items. The empty state is the palette's
  most-used state — summon-enter with no typing is the "switch back" gesture.
- **The prior weights within the matched set; it never overrides matching.**
  An item that does not match the typed text does not appear because it is
  beloved. The blend tunes *order among candidates*, keeping the blind-enter
  contract learnable: text narrows, history breaks ties.
- **History keys off stable identity**, so a renamed command keeps its
  earned rank, and off the query when feasible — remembering that "dep" led
  to a specific destination makes the *next* "dep" instant.

## Scope honesty, palette-sized

The palette states its corpus in its affordances: placeholder text and
section labels tell the user whether they are searching commands, pages,
entities, or all three — and prefix sigils (a leading character selecting a
mode) are the conventional way to let one input serve several corpora
without ambiguity. What the palette does not index, it does not pretend to:
a palette that finds some entities sometimes, on an index with unstated
lag, erodes the reflexive trust that a smaller, honest corpus would keep.
