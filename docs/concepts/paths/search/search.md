---
layer: golden-path
subject: search
status: forged
techniques:
  - query-parsing
  - full-text-indexing
  - ranking-and-excerpts
  - faceting-and-filters
  - saved-views
  - command-surface
evidence:
  - src-tauri/db/src/repos/execution/executions.rs              # build_fts5_query (one sanitization door: tokenize→quote→bounded) + search (bm25 ranking, snippet excerpts, join-back to source)
  - src-tauri/db/src/migrations/schema.rs                       # external-content FTS index + synchronous ai/ad/au maintenance triggers
  - src-tauri/db/src/lib.rs                                     # executions_fts_drift / ensure_executions_fts — startup reconciliation with a named rebuild path
  - src/features/templates/sub_generated/gallery/search/suggestions/useStructuredQuery.ts  # closed prefix set lifted into removable typed chips; remainder stays keyword text
  - src/features/shared/chrome/commandPaletteUtils.ts           # registry-derived palette corpus, banded fuzzy scoring with field weights, session recency
  - src/features/overview/sub_events/libs/useEventLog.ts        # saved views persisting the typed predicate (view_config), applied by re-execution
  - src/features/shared/components/display/facetedTableModel.ts # facet tree derived from data, own/total counts bubbled, deterministic child sort
counter_evidence: []
deviations:
  - w1-search   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Search

Search is the surface you reach for when the user has an **information need
expressed in their own words, over a corpus too large to see**. That definition
carries three commitments most implementations forget they made: the user's
words are not the engine's syntax (someone must translate, safely); the corpus
is invisible (so the surface must be honest about what was and was not
searched); and the result set is too big to be useful unordered (so ranking is
not a nicety — ranking *is* the product).

## Three intents that wear the same text box

The single costliest confusion in this subject is treating search, filter, and
navigate as one feature because they share an input field. They are three
different user intents with different correctness criteria:

- **Navigate** — the user already knows the destination and wants the shortest
  path to it: a command, a page, a record they can name. Correctness is *the
  thing I meant is the top hit*. Matching is name-shaped (prefix, fuzzy,
  abbreviation), recency and habit are legitimate ranking signals, and the
  interaction is keyboard-first with instant response. This is the
  [command-surface](techniques/command-surface.md) technique.
- **Filter** — the user is looking at a bounded dataset and carving it down.
  The records don't change, the predicate does. Correctness is *exactly the
  rows matching the predicate, in the order the surface already had*.
  Relevance ranking is actively wrong here: re-ordering a filtered table by
  match score destroys the comparison job the table exists for. Counts matter;
  excerpts do not. This is [faceting-and-filters](techniques/faceting-and-filters.md).
- **Search** — the user describes what they want and the system finds
  candidates they could not have named. Correctness is *the best answers near
  the top, each one explaining why it matched*. Ranking, excerpts, and
  tolerance for imprecise queries are the whole game.

Mistaking one for another produces recognizable defects: full-text ranking
bolted onto a filter box makes row order twitch with every keystroke; a
substring filter standing in for search returns four hundred unranked
haystacks; a search index powering the command palette makes "settings" rank
below a document that mentions settings nine times. Decide which intent a
surface serves *first*; the implementation follows.

## The pipeline: four stages, four owners

Every search interaction traverses the same pipeline, and each stage has a
distinct correctness contract:

**1. Raw input.** Whatever the user typed, exactly as typed. It is never fed
directly to anything that has syntax. The moment raw text can reach an engine's
expression language, some user's innocent punctuation becomes a syntax error or
— worse — an operator they didn't intend. There is exactly one door between
user text and engine expression, and everything passes through it
([query-parsing](techniques/query-parsing.md), citing the one-validation-door
law).

**2. Parsed query.** The structured form: recognized operators lifted out
(field prefixes, phrase quotes, negation), the free-text remainder sanitized
into an engine-safe expression. Parsing is *visible* — recognized structure is
reflected back to the user (as chips, as highlighted tokens) so they learn the
grammar by using it, and so they can see when the system understood something
different from what they meant.

**3. Ranked results.** Execution against an index or a scan
([full-text-indexing](techniques/full-text-indexing.md)), scored and ordered
deterministically ([ranking-and-excerpts](techniques/ranking-and-excerpts.md)).
Deterministic matters: the same query over the same corpus yields the same
order, ties broken by stable identity, or results shuffle between keystrokes
and the user cannot build a mental map of the list they are scanning.

**4. Presented excerpt.** Each result justifies its presence: where it
matched, shown in context, with the matched terms marked. A result the user
cannot see the reason for is indistinguishable from a bug, even when the
ranking was right.

## The latency budget

Search feels instant below roughly 100 milliseconds keystroke-to-paint and
feels broken above roughly a second. The budget is spent in four places —
debounce, query execution, ranking, render — and the first is the one teams
forget is spending it: a 300ms debounce has consumed three times the "instant"
budget before the engine even starts. Spend deliberately:

- **Debounce buys throughput, not latency.** Use the smallest debounce that
  protects the engine, and consider none at all when the engine is local and
  indexed — an indexed lookup over a personal-scale corpus is usually cheaper
  than the debounce that guards it.
- **Results must be attributable to a query.** As-you-type search issues
  overlapping requests, and responses arrive out of order. The surface renders
  only the response to the *latest issued* query — sequence-checked, not
  arrival-ordered. Without this, a slow response to "app" overwrites the fast
  response to "apple" and the results visibly regress while the user types
  forward.
- **Never blank the previous results while the next are in flight.** Showing
  stale-but-labeled results beats a flashing empty pane; the body-state
  discipline is the same one every data surface owes (populated-refreshing
  never hides rendered content).

## Honesty: what was actually searched

A search surface makes an implicit claim — "I looked" — and the claim has three
qualifiers the surface must be able to state:

- **Scope.** Which entities and which fields were searched. "No results" means
  something entirely different when titles were searched than when full content
  was; a user who assumes content-search over a title-only index will
  conclude the data is missing. Say what the box searches, at the box.
- **Staleness.** If results come from an index maintained asynchronously,
  results lag reality. Recently created items that don't appear yet, and
  deleted items that still do, are index-lag artifacts; the surface should
  either keep the lag below perception or disclose it.
- **Truncation.** "Top 50 of about 3,000" and "all 12 matches" are different
  claims. A cut-off result list rendered without a more-exists marker teaches
  users the false lesson that what they see is all there is. Every count a
  search surface shows carries its predicate — matched *what*, in *which
  scope*, cut at *what limit*.

And the empty state is three states, not one: **no matches** (the search ran,
nothing qualifies — offer query broadening), **degraded query** (the input
couldn't be honored as written and the system searched something weaker —
label the substitution), and **engine failure** (nothing was searched — say so
and offer retry). Rendering all three as one "no results" pane converts every
outage into silent data loss (the failure-not-empty-success law; the
[query-parsing](techniques/query-parsing.md) technique owns the degradation
ladder).

## Persistence of the search context

A query worth typing is often worth keeping. Two graduated forms:

- **Navigational state** — the current query, filters, and sort survive
  back-navigation and refresh, or are deliberately reset. Losing a
  five-clause filter to an accidental navigation is data loss.
- **Named state** — a query/filter/sort bundle promoted to a durable, named,
  recallable artifact: the [saved-views](techniques/saved-views.md) technique.
  The discipline that separates a robust implementation from a brittle one is
  that a view stores the *predicate*, not the results, and validates that
  predicate against the current schema every time it is applied.

## The techniques

- [query-parsing](techniques/query-parsing.md) — two grammars (user's and
  engine's), the single sanitization door, structured prefixes and chips, the
  empty-result degradation ladder.
- [full-text-indexing](techniques/full-text-indexing.md) — index vs scan,
  tokenization decisions, keeping a derived index honest against its source
  of truth.
- [ranking-and-excerpts](techniques/ranking-and-excerpts.md) — relevance
  signals and their combination, deterministic total order, snippets as
  justification.
- [faceting-and-filters](techniques/faceting-and-filters.md) — enumerable
  dimensions with counts, the AND-across / OR-within grammar, filter state as
  navigational state.
- [saved-views](techniques/saved-views.md) — naming a predicate, view
  identity, schema drift, dirty state.
- [command-surface](techniques/command-surface.md) — the navigate intent:
  keyboard-first palettes, weighted fuzzy scoring, recency blending, one
  command registry.
