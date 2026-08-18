---
layer: technique
subject: file-browsing
technique: kind-taxonomy
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Kind taxonomy

The store hands the browser undifferentiated names and bytes; the browser
answers with a taxonomy — *image*, *video*, *document*, *audio*, *model*,
*other* — that drives nearly everything the user touches: which icon an item
wears, which preview rung it can climb, which filter chips exist, how
grouping and sorting read. The technique is small and structural: **the
taxonomy is one closed vocabulary with exactly one authoritative
definition**, and everything else derives from it.

## One authority

Kind classification appears in many places — the tile that picks an icon,
the filter bar that offers chips, the preview dispatcher that picks a
renderer, the sort comparator that orders "by kind", the group headers that
bucket a library view. Implemented as five local judgment calls ("does the
extension look like an image?" asked five ways), the buckets drift apart the
first time someone adds a kind or a new extension: the filter finds a file
the icon does not recognize, the preview refuses a file the filter calls an
image. The fix is structural, not disciplinary: one classification function,
one kind enumeration, and every consumer — icons, chips, dispatch, sort,
grouping, per-kind counts — derives from it. Adding a kind is then one
edit that every surface inherits.

## Classification honesty

- **Classify by the cheapest reliable signal, and say which.** The name's
  extension token is the standard first signal — cheap, wrong in known ways
  (renamed files, absent extensions). Content sniffing is stronger and
  costlier. Whichever the browser uses, use it *consistently*: a file the
  tile classifies one way and the preview dispatcher another produces the
  visibly insane "image icon, refuses to preview as image" state.
- **`other` is a real bucket, not a bug.** Unrecognized kinds get the
  fallback icon, no preview rung above it, and full membership in every
  other behavior — selectable, renamable, filterable *as* "other". A
  taxonomy that panics on the unrecognized will panic often; stores are
  full of things nobody planned for.
- **The vocabulary is closed and versioned.** Filter state, persisted view
  state, and per-kind settings all reference kind tokens; a renamed token
  orphans everything that stored the old name. Tokens are identifiers with
  compatibility obligations, not display strings — display names are looked
  up per locale from the token, never stored.

## Filters and counts

Kind chips are the browser's native filter vocabulary; they compose with
name search (whose query mechanics belong to the search subject — the
taxonomy contributes tokens, not matching). Two honesty rules:

- A chip that shows a count shows the count *under the current scope and
  remaining filters*, and it says so — "Images (34)" meaning
  34-in-this-folder is a different fact from 34-everywhere, and the wrong
  reading sends the user hunting for 30 files that are not here.
- An active kind filter is visible from across the room. The most common
  "my files disappeared" report is a forgotten filter; the surface's state
  banner ("showing images only — clear") is cheaper than the support
  conversation.
- A filter can be *stranded*: the store changes and the filtered kind no
  longer exists in scope, leaving a permanently empty view whose cause is a
  chip the user set an hour ago. Re-validate active filters against each
  fresh listing and drop (or loudly disclose) the ones whose bucket
  vanished — filters reconcile with reality the same way expansion and
  selection do.

## Grouping and date buckets

Library-style views group by kind or by recency ("Today", "This week",
"Earlier"). Group headers are derived rows, not data: they are computed
from the item's kind token or timestamp at render time. Date bucketing has
two sharp edges worth designing once: buckets are computed in the *user's*
calendar (a photo from 23:50 belongs to yesterday, not to eleven hours
ago), and bucket boundaries move while the surface is open — a view that
straddles midnight regroups on its next refresh, which is correct and
should not be fought.

Sorting by kind uses the vocabulary's declared order (a deliberate ranking,
usually by frequency of use), not the alphabetical accident of the token
spelling — and within a kind, falls back to the surface's normal comparator
with a stable tiebreaker on identity, so equal-kind items do not shuffle
between refreshes. One ordering rule sits above the vocabulary entirely:
**containers sort before leaves regardless of the active sort key** — the
folder-first convention is how every browser the user has ever used arranges
a hierarchy, and a sort that interleaves folders among files reads as
broken, not as configurable.
