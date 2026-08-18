---
layer: technique
subject: versioning-snapshots
technique: lineage-and-variants
status: forged
laws: [identity-survives-reuse, count-carries-predicate]
shared_with: []
---

# Lineage & variants

The version *number* records when a state was saved; **lineage** records
where it came from. The two are independent, and systems that store only
the number are betting that history is a straight line — a bet that the
first restore, the first experimental variant, or the first pair of
concurrent editors loses. v8 restored from v3 is *chronologically* after
v7 but *genealogically* a child of v3; a picker that renders only the
sequence tells the reader a false story about what v8 is.

## One nullable edge buys the whole graph

The mechanics are almost embarrassingly cheap: each version stores a
**parent edge** — the global id (never the human number:
[identity-survives-reuse](../../_laws.md#identity-survives-reuse)) of the
version it was derived from, null for genesis. Written at creation time
by whichever event created the version:

- a routine save's parent is the previous head;
- a restore's parent is the version it revived;
- a variant's parent is the version it forked from;
- a partial restore records both sources (one parent edge plus a
  provenance note, or a second edge if the model supports it).

The cost is one nullable column and the discipline of setting it in the
one capture routine. The alternative is archaeology: reconstructing
provenance later from timestamps and content diffs, which fails exactly
for the interesting cases (a restore is content-identical to its source,
so diffing cannot distinguish "restored from v3" from "coincidentally
retyped v3").

## Variants are branches, and branches need a name for "which line"

An experimental variant — fork v4, mutate, measure — creates a second
line of descent, and now every consumer that assumed "the versions of
entity E" was a list needs a sharper question. Three structural choices,
in increasing order of weight:

- **Lineage-only branching.** Variants live in the same version sequence,
  distinguished only by parent edges. Cheapest; right when variants are
  short-lived experiments that either promote or die. The version list
  renders as a list with fork annotations, and "the line" is recovered by
  walking parents from the active version.
- **Named branches.** A branch label on each version partitions the
  history into named lines. Right when variants live long enough to need
  addressing ("the aggressive-tone line") and per-line comparison.
- **Variant-as-entity.** The fork creates a sibling entity carrying a
  lineage edge back to the source version. Right when variants must be
  independently runnable, ratable, and lifecycle-managed — at the price
  that cross-variant history now spans entities and needs its own query.

The choice is driven by what must be *compared*: within-line comparison
(this version vs its parent — the improvement question) needs only parent
edges; across-line comparison (variant A vs variant B — the selection
question) needs the lines to be addressable. The comparison machinery
itself — paired trials, judges, win-rates — is the eval-harness subject's
ground; lineage's job is to guarantee the comparison can *name its
operands* precisely.

## Comparisons cite ids, verdicts cite comparisons

Every cross-version claim — "v7 beats v4", "the variant regressed" — is a
count with a predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)): it
must record *which exact versions* (global ids), on *what measure*, over
*what inputs*. A comparison recorded against "the current version" decays
into fiction at the next save; a comparison recorded against version
numbers breaks if any display renumbering ever occurs. Lineage plus
pinned comparisons is what makes the history *answerable*: which change
introduced the regression becomes a walk up the parent chain with
measurements attached to nodes, instead of a memory exercise.

## Prohibitions

1. No version without a parent edge (null only for genesis).
2. No lineage recorded by human number — parent edges use the global id.
3. No restore or fork that leaves the default "parent = previous head"
   in place — the edge records the true source.
4. No variant scheme chosen implicitly; lineage-only, named branches, or
   variant-as-entity is a declared decision driven by the comparisons
   the product must answer.
5. No cross-version measurement stored without the exact ids of both
   operands.
