---
layer: technique
subject: templates-scaffolding
technique: catalog-curation
status: forged
laws: [count-carries-predicate, creation-names-reaper, one-validation-door]
shared_with: []
---

# Catalog curation

A catalog accumulates by default: every generation run, every author's
near-duplicate, every experiment that shipped and was never revisited.
Curation is the standing decision of what the catalog is *for*, executed as
mechanism — an admission bar, a taxonomy, a dedupe discipline, and a
retirement path — because a catalog governed only by addition converges on
a junk drawer with a search box, and the browse surface pays the price on
every visit.

## The admission bar is the other gates, applied at one door

Curation's first mechanism is not taste; it is **enforcement of the
subject's other techniques at the moment of entry**, through one door every
writer passes ([one-validation-door](../../_laws.md#one-validation-door) —
human author, generator, importer, seed pipeline: same door, same checks):

- structural self-consistency — the defaults-within-options invariant and
  its siblings ([template-anatomy](template-anatomy.md));
- portability — the strip pass and leak lint
  ([template-portability](template-portability.md));
- integrity — digest recorded, provenance stamped
  ([integrity-and-provenance](integrity-and-provenance.md));
- declared requirements present and well-formed
  ([readiness-prerequisites](readiness-prerequisites.md)).

The measured incident that anchors this subject — ten internally
inconsistent templates live in a catalog — is precisely what a door-less
catalog produces: the generator was trusted as a writer, and generators are
the *highest*-volume, *least*-reviewed writers a catalog has. Taste
questions (is this entry good?) come after mechanism questions (is this
entry valid?), and only the second kind belongs in software.

## Curated core and generated tail are different shelves

Catalogs healthily contain two populations with different contracts, and
curation's job is to keep them **visibly distinct** rather than equally
prominent:

- the **curated core** — few, maintained, exemplary; each entry has an
  owner, passes the full bar, and is the product's opinion of a good
  starting point;
- the **generated tail** — many, cheap, machine-drafted; useful as raw
  material, reviewed lightly or not at all.

Blending the shelves debases the core: an adopter who hits three mediocre
generated entries stops trusting the gallery, and the curated core loses
its audience to the tail's volume. Label the populations, rank the core
first, and let the tail be explicitly a tail — searchable, but never
impersonating curation.

## Dedupe is a judgment call executed as policy

Near-duplicates arrive constantly (two authors, one obvious idea; one
generator, many similar drafts). The policy that works: **one canonical
entry per intent**, with variants expressed as *dimensions of the
canonical entry* rather than as sibling entries — the parameter surface
exists precisely so that "the compact one" and "the detailed one" are one
template with a layout dimension, not two catalog rows competing in
search. Where a genuine fork exists (different intent, not different
option), both stay, and their descriptions state the difference — the
catalog's search surface is where the adopter arbitrates, and identical
descriptions on distinct entries mean the catalog has not decided what
either is for.

## Retirement: every entry names its way out

[creation-names-reaper](../../_laws.md#creation-names-reaper), applied to
catalog rows: admission is granted **with** the retirement path, because
nobody re-asks "who deletes this?" later — a catalog that only grows is
the temp-file leak of the content world. The working parts:

- **Deprecation before deletion**: a retiring entry stops being offered
  (hidden from browse, blocked from new adoption) before its record
  disappears — existing instances keep their provenance stamp resolvable
  for as long as forensics needs it. Deleting the row an instance's stamp
  points at converts every such instance into an orphan with a dangling
  origin.
- **Freshness is measured, not felt**: adoption counts, last-adopted
  time, and readiness-block rates per entry tell curation which entries
  earn their shelf space and which block everyone who tries them.
  Retirement driven by data is defensible; retirement driven by tidying
  enthusiasm deletes someone's favorite.
- **Built-in entries retire by upgrade rules**: content the product
  itself seeds needs an explicit reconcile policy on re-seed (new
  version replaces, user-modified copy is preserved, removed-upstream is
  deprecated) — the seed pipeline is an adopter too, and it runs on
  every startup with nobody watching.

## Count the catalog with its predicate

"How many templates do we have" is not one number, and reporting it as one
is how catalogs lie to their owners
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
entries on disk, entries passing the admission bar, entries visible in
browse, entries adoptable *ready* in a typical environment, entries
adopted at least once — five different numbers, and the gap between any
two is a curation finding. The number that belongs on the marketing page
is the second; the number that belongs on the curation dashboard is every
pairwise gap, because "200 on disk, 140 admissible, 30 ever adopted" is
the whole curation backlog in one line.
