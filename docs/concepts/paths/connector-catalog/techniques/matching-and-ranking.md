---
layer: technique
subject: connector-catalog
technique: matching-and-ranking
status: forged
laws: [failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Matching and ranking

Work arrives naming services in vocabularies the catalog does not control: an
automation imported from a foreign tool names its steps in that tool's node
types, a user types three characters into a picker, a marketplace listing
spells a vendor two ways. Matching resolves a **foreign reference to a minted
catalog identity** — and because a wrong resolution silently wires the wrong
service's credentials and adapter into someone's workload, the technique's
center of gravity is not cleverness in scoring but **honesty about
confidence**.

## Tiers before scores

A single fuzzy score collapses distinctions that matter. Rank in tiers, each
strictly outranking everything below, and stop at the first tier that
produces hits:

1. **Exact identity** — the foreign reference *is* a catalog key. Trust it.
2. **Alias table** — known foreign spellings mapped to identities by a
   maintained table: prior rebrands, the foreign tool's own type names,
   community spellings. Every resolved rename belongs here
   ([identity-survives-reuse](../../_laws.md#identity-survives-reuse) —
   aliases are how identity survives the *world* renaming things around it).
   The alias table is the highest-leverage artifact in the technique:
   deterministic, reviewable, and it converts yesterday's hard fuzzy case
   into today's exact hit.
3. **Normalized equality** — case-folded, separator-stripped, vendor-suffix
   trimmed. Deterministic still, but derived.
4. **Fuzzy overlap** — token overlap, substring containment, edit distance.
   Only here do scores appear, and only to order candidates *within* the
   tier — never to let a good fuzzy hit outrank a deterministic one.

The tier that produced a match is part of the result. Downstream policy
hangs off it: exact and alias matches may auto-bind; fuzzy matches should
present, not decide.

## The vacuous match

Normalization is where matchers go quietly wrong. Strip enough — whitespace,
punctuation, vendor words, then a two-character token remains — and the
residue matches half the catalog by substring. The ranker, asked for a top
hit, supplies one; every consumer downstream inherits a confident-looking
lie. Guards:

- **Minimum-signal floor.** Below a threshold of surviving characters or
  tokens after normalization, the matcher refuses to enter the fuzzy tier at
  all. Short input is allowed to *filter* (interactive pickers) but not to
  *bind* (automatic resolution).
- **Score with respect to both sides.** Containment scored only against the
  candidate's length lets a tiny query "fully match" a long name. Symmetric
  measures (or explicit length penalties) keep a three-letter fragment from
  claiming everything containing it.
- **Discrimination check.** If the top N candidates score within noise of
  each other, the match is ambient, not specific — treat as ambiguous
  regardless of absolute score.

## No-match and ambiguity are results, not failures to hide

The matcher's output vocabulary has three members, and consumers must see
all three ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
— returning the least-bad candidate to avoid an empty result is the empty
success in its most damaging costume):

- **Resolved** — one identity, with its tier and score.
- **Ambiguous** — multiple credible candidates. Where a human is present,
  surface them as a choice; in an import flow this becomes a review step.
  Where no human can choose — an unattended auto-bind — an ambiguous tier
  resolves **as if empty**: fall through to the next tier or return
  unresolved, never first-wins. (A measured form of this discipline: a
  binder whose prefix tier accepts its result only when exactly one
  candidate survives, and otherwise declines the whole tier.) Picking
  silently by top-score converts a coin flip into configuration.
- **Unresolved** — nothing credible. This is *valuable signal*: in imports
  it marks the step needing a manual mapping or a new catalog entry; in
  aggregate, frequent unresolved spellings are the alias table's backlog,
  and a spike after a catalog update is a regression alarm.

Never mint an identity from a failed match. A placeholder row fabricated to
make an import "succeed" pollutes the namespace the next import matches
against, and the fabricated identity is indistinguishable from a curated one
forever after. Unresolved references stay foreign — labeled, preserved
verbatim for later re-matching — until a human or a new alias resolves them.

## Preserve the evidence

Every resolution — auto or manual — should record *what* matched *how*: the
verbatim foreign reference, the tier, the score, the chosen identity. Three
consumers pay for this immediately: debugging ("why did this import wire to
that service?"), re-matching (when the catalog gains entries or aliases,
previously unresolved and fuzzy-resolved references are re-run — impossible
if the verbatim input was discarded at resolution time), and alias mining
(confirmed manual corrections are alias-table entries with evidence
attached). A matcher that returns bare identities and forgets the question
answers each of these with a shrug.
