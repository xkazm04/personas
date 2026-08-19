---
layer: technique
subject: search
technique: faceting-and-filters
status: forged
laws: [count-carries-predicate, one-authority-per-vocabulary]
shared_with: []
---

# Faceting and filters

A facet is an attribute with an enumerable value set, offered as a clickable
dimension of the result space: status, type, owner, tag, date bucket. Facets
serve the *filter* intent — the user carving a visible dataset down — and
their power is that they answer a question before it is asked: the facet
panel with counts is a map of where the results live. That map is also where
this technique's defects concentrate, because every number on it is a claim.

## The grammar users assume

Combinability follows a convention so widespread it functions as a standard,
and violating it reads as a bug:

- **OR within a facet.** Selecting "failed" and "cancelled" under Status
  means *either* — the user is widening within the dimension.
- **AND across facets.** Status "failed" plus Owner "me" means *both* — the
  user is intersecting dimensions.
- **Free text ANDs with everything.** The typed query and the facet
  selections jointly restrict; neither overrides the other.

State the grammar in the surface's behavior, not in documentation: checkboxes
within a group (multi-select, union) versus separate groups (intersection) is
how the convention is communicated. A facet that secretly ANDs within itself
produces instant empty results and teaches the user the panel is dangerous.

Negative selection ("everything except archived") is worth offering only when
the product has a real exclusion habit; it doubles the mental model's size
for every user to serve some users.

## Counts carry their predicate

Every count in a facet panel answers a specific question, and there are two
defensible questions with different answers:

- **"How many results in my current selection have this value?"** — counts
  conditioned on the full current predicate. Consistent, but every count in
  an unselected sibling of the current selection reads zero, making the panel
  useless for widening.
- **"How many results would I have if I also selected this value?"** — the
  conventional choice: for values *within a facet the user has already
  selected in*, counts are computed as if that facet's own selection were
  removed (the disjunctive convention), while all other facets' selections
  still apply. This is what lets a user who selected "failed" still see how
  many "cancelled" exist to add.

Hierarchical facets (a taxonomy rail, a slash-path tree) add a third count
distinction: items *exactly at* a node versus items *at or under* it. Both
are legitimate; a node's displayed number must be one of them consistently,
and when the tree is derived from the data rather than declared, derive it
with deterministic child ordering (count, then name) so the rail does not
reshuffle between renders.

Either convention is honest if applied consistently and recomputed when the
predicate changes; a panel that mixes the two, or that renders counts minted under a
previous selection beside results of the current one, shows numbers that are
lies with digits (count-carries-predicate). When counting is expensive,
degrade honestly: presence indicators or bounds ("20+") beat stale precision.

**Zero-count values** get one of three treatments — hidden (cleanest panel,
but the vocabulary appears to shrink, confusing users who know the value
exists), disabled-but-visible (the conventional best default: the dimension's
full shape stays visible, dead ends are unclickable), or clickable (only
correct under the disjunctive convention, where selecting them is not a dead
end). Pick one policy for the product; per-panel variation reads as chaos.

## The vocabulary has one owner

A facet over a closed vocabulary — statuses, types, severities — renders that
vocabulary, and the one-authority-per-vocabulary law applies: the facet's
option list derives from the same single definition the rest of the system
uses, not from a hand-maintained copy in the filter panel. The hand copy
fails in the characteristic way: someone extends the vocabulary, the new
value ships everywhere except the filter, and records wearing it become
unfilterable-to precisely because they are new. Facets over open vocabularies
(tags, owners) derive their options from the data — which means the option
list is itself a query with a staleness story.

## The completeness precondition

A filter evaluated in memory carries an obligation the server-evaluated kind
does not: **the collection being filtered must be the complete candidate
set.** A filter applied over a window the fetch already capped — the first
page, the most recent N, a bounded buffer — does not return a slow answer, it
returns a *wrong* one: "no results" for records that exist, rendered under a
header still quoting the full corpus count. The defect is invisible locally
because every line is correct in isolation; the relation between the
predicate here and the limit in the fetch is what breaks.

So, per filter dimension, answer one question in writing: *is this evaluated
over everything, or over a window?* If over everything, prove it (the fetch
takes no limit, by construction). If over a window, either send the dimension
to the tier that sees the whole set, or **disclose the window on the
surface** — show the loaded-window count beside the corpus count and say
which is which. Independent systems converge on the disclosure sentence
("filters and counts below cover rows X–Y, not the whole set") because the
precondition cannot be made structurally unrepresentable at the surface; when
prevention is out of reach, honesty is the standard.

Two corollaries: derive facet option lists from the whole vocabulary, not
from the loaded rows (an option list built from the window cannot offer
values whose rows haven't loaded, and reshapes itself as the user scrolls);
and never pair a client-filtered row count with a server-computed total —
every displayed number describes one set, named.

## Filters and pagination

A filter change invalidates the current page position: the page index pointed
into the *old* set, and clamping it into range in the new one strands the
user mid-way through different data. **Reset to the first page on any filter
change — reset, not clamp.** The same applies to cursors: a keyset cursor
minted under one predicate must not be resumed under another. Surfaces that
skip this ship the classic pair of defects — "page 2 of the filtered list is
empty" and "I filtered and it kept me on page 3".

## Filter state is navigational state

The active filter set is part of where the user *is*:

- **It survives what it should survive.** Refresh, back-navigation, and
  detail-and-return keep the filters, or the surface deliberately resets —
  chosen, not accidental. Losing a carefully built five-clause filter to a
  routine navigation is the filter equivalent of a lost draft.
- **It is visible in one place.** Active filters render as a removable-chip
  row (or equivalent) above the results — every active clause visible,
  individually removable, with one clear-all. Filters active but invisible
  (buried in a collapsed panel, applied by a default the user never chose)
  are the mechanism behind the support ticket that reads "my data is gone".
- **It is shareable when locations are shareable.** If the surface has
  addressable locations, the filter state serializes into them, so a
  colleague opening the shared address sees the same slice.
- **Defaults are declared.** A surface that opens pre-filtered (current
  period, active-only) shows those defaults as removable chips like any user
  choice. A default the user cannot see is a default they cannot remove.
- **"Has the user filtered?" is one shared predicate**, and it compares
  against the *default* state, not against emptiness. When the default
  filter is itself non-empty, a naive any-filter-set check reports
  "filtered" on first paint — and the empty state tells a brand-new user to
  adjust filters they never touched. Hoist the narrowed-vs-default predicate
  into one place so the filter bar, the empty state, and any header badge
  cannot disagree about it.

## Interaction with the other techniques

Filters restrict the candidate set before ranking scores it — membership and
order stay separate concerns. The parsed query carries typed filters and
free text as one artifact, so field-prefix chips from
[query-parsing](query-parsing.md) and panel selections land in the same
predicate rather than two competing ones. And the full bundle — text,
filters, sort — is what [saved-views](saved-views.md) names and persists; a
filter state worth rebuilding twice is a view waiting to be saved.
