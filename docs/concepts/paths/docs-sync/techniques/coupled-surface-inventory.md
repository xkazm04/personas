---
layer: technique
subject: docs-sync
technique: coupled-surface-inventory
status: forged
laws: [gate-sees-target, one-authority-per-vocabulary]
shared_with: []
---

# Coupled-surface inventory

A user-visible change rarely owes one document. The mature product carries a
*family* of prose surfaces describing the same features at different
altitudes: the reference documentation a developer reads, the onboarding
tour a new user walks, the marketing guide a prospect skims, the visibility
metadata (mode tags, tier flags) that controls where features appear. Each
surface rots on its own schedule, and settling the obligation one surface at
a time across sessions guarantees the family disagrees with itself. The
technique: **enumerate the coupled surfaces per feature, in the same map
that declares the source coupling, and check each surface independently in
the same change.**

## One entry, many target types

The map entry (see [source-doc-mapping](source-doc-mapping.md)) carries a
slot per surface type. In the exemplar: a required reference-doc target, an
optional list of tour-flow ids, an optional marketing-module id — three
independent checks, three independently phrased miss messages, combined into
one reminder. The independence matters in both directions: a change can owe
the tour but not the marketing guide, and a satisfied reference doc must
never silence the tour check. Each miss message names its specific target —
*this* flow, *this* step artifact, *this* module — because a generic
"update the docs" nag is discharged by whichever edit is nearest.

The surface family in full, for inventory completeness:

- **reference docs** — the implemented-product contract; always coupled;
- **onboarding tours** — coupled when the changed flow is one a tour walks;
  what a step contains is [guided-tours](../../guided-tours/guided-tours.md)'
  business, but *that the step is owed* is this map's;
- **marketing / guide content** — coupled at the product-explanation level;
  a refactor below that altitude legitimately dismisses;
- **visibility metadata** — mode tags and tier gates on guide topics must
  move when the feature moves between modes;
- **translations and changelogs** — owed through their own subjects'
  disciplines ([i18n](../../i18n/i18n.md),
  [release-pipeline](../../release-pipeline/release-pipeline.md)); the
  inventory's job is only to remember they exist.

## Two artifacts agreeing is not either being right

The tour half of the exemplar map exposed a failure mode worth its own
paragraph. The flow registry and the entries that referenced it were
mutually consistent — every referenced flow existed, every registered flow
was referenced — and **both were six flows short of the live tour tree**:
six shipped tour steps registered nowhere, three registry entries naming no
live step. Consistency between two declared artifacts measures only that
they were edited together; correctness requires reconciling either against
the ground truth they describe
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary):
if the tour tree is the authority, the registry is a derived view and needs
a derivation check, not a cross-reference check). An inventory check that
never looks at the live surface certifies bookkeeping, not coverage —
measured consequence: the tour obligation was structurally unreachable for
20 of 37 entries, and over history only 2.2% of triggering commits touched
any tour file.

## Cross-repo surfaces: a report, never a gate

Some coupled surfaces live in another repository — the marketing site, the
public guide content. The temptation is to extend the same-change check
across the boundary: "satisfied if any file in the sibling checkout was
edited." Measured verdict on that design: the check's outcome becomes a
function of whether *a sibling checkout exists on this machine at this
relative path* — present on the author's box, absent on every fresh clone
and every automation runner
([gate-sees-target](../../_laws.md#gate-sees-target): the gate's target sits
where the gate cannot reliably see). And prefix-satisfaction is at its
weakest here — *any* edit in an entire sibling repository discharging a
specific guide obligation.

The honest architecture: within-repo surfaces are gated; cross-repo surfaces
are **reported** — the obligation is published (a breadcrumb naming the
affected module, a queue the sibling repo's sync process consumes, a marker
the catch-up pass reads; see [catch-up-markers](catch-up-markers.md)) and
settled by the other repository's own machinery. Pretending to gate what you
cannot see produces the worst of both: noise on the machines where the
sibling exists, silence where it does not, and no record either way.

## The dismissal altitude

Each surface type has its own dismissal altitude, and the inventory should
state it. A renamed internal function dismisses everything. A changed flow
dismisses marketing but owes the tour. A renamed product concept owes all
of them. Writing the altitude into the map's entry descriptions — what
level of change reaches this surface — is what turns dismissal from a
judgment call repeated per change into a documented policy applied per
change.
