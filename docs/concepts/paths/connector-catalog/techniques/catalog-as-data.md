---
layer: technique
subject: connector-catalog
technique: catalog-as-data
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Catalog as data

The formative move of the whole subject: a supported external service is a
**declarative record**, and every surface that touches integrations is written
against the record shape, never against a particular service. This technique
is about what earns a place in the record, how the record's vocabularies stay
closed, and where the data/code boundary honestly sits.

## The boundary test

A service belongs entirely in data when a reviewer who knows the *service*
but not the *codebase* could add it: fill in identity, presentation, auth
fields, capabilities, probe recipe, taxonomy — and every consuming surface
lights up without a new branch anywhere. The moment a service needs a
conditional inside a consumer ("if it's this one, page differently"), the
design has failed the test in the expensive direction: that knowledge belongs
either in the row (a new declarative attribute *all* rows can carry) or in a
registered per-service unit ([adapter](adapter-normalization.md) or
[form override](schema-driven-forms.md)) keyed by the row's identity. The
choice between those two is itself principled: **prefer promoting the
difference to a row attribute** when a second service could plausibly share
it, and reach for code only when the difference is behavioral and singular.

Held to, this yields the property that makes catalogs compound in value:
the cost of service N+1 stays flat while the payoff grows with every consumer
added, because each new consumer written against the record shape multiplies
across all existing rows at once.

## Anatomy of a row

The fields recur across every serious catalog; each exists because a specific
consumer reads it.

- **Identity** — a minted, stable machine key. Never the display label, never
  the vendor's current brand, never positional
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
  Credential instances, adapters, matchers, and audit lines all reference it;
  it is the one field that can never be edited, only aliased
  ([catalog-lifecycle](catalog-lifecycle.md)).
- **Presentation** — label, icon, brand color, short description. Explicitly
  *not* load-bearing: anything a rename can break was keyed wrong.
- **Auth schema** — the declared credential shape: field keys, types,
  secret flags, required flags, option lists, help text. The single authority
  that [schema-driven-forms](schema-driven-forms.md), validation, probing,
  and redaction all read.
- **Capability declarations** — what the service offers, in the product's own
  nouns: the operations it can perform, the events it can emit, the resource
  kinds it exposes. These are promises consumers branch on — a picker offers
  only services declaring the needed capability; an event-subscription
  surface lists only declared events. An undeclared capability is invisible;
  a falsely declared one is a runtime failure wearing a feature's clothes —
  so declarations need a verification story, not just an author.
- **Probe recipe** — how to cheaply verify a credential of this type:
  endpoint template, substitution of declared fields, expected response
  class. Declared here, executed by the health machinery.
- **Taxonomy** — the discovery axes: a category for browsing, functional
  roles for "what can fill this slot in a composition", audience tags for
  who should see it, licensing tier for who may use it. Each axis is a
  **closed vocabulary with exactly one authoritative definition**
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary));
  a free-text category field fragments into synonyms within a quarter, and a
  tier list copied into the gating code drifts from the tier list in the
  rows the first time marketing renames a plan.

## Vocabularies evolve; consumers must not fork

Two evolution patterns recur, and both have a disciplined form:

- **An axis goes single-valued → multi-valued** (one category becomes a tag
  set, because real services straddle). The disciplined move is one reading
  function that unions the legacy scalar with the new list, so every consumer
  keeps calling one accessor and none forks on "old row or new row". The
  scalar is retired only when a migration has rewritten all rows — until
  then the union *is* the authority.
- **Taxonomy born beside the rows migrates onto them.** Mappings often start
  as a hand-maintained table next to the catalog (role → member identities,
  identity → audience tags) because editing N rows is slower than adding one
  table. That is a second authority in embryo, and it drifts the day a row
  is added to the catalog but not to the side table. The honest transitional
  form — observed working in the field — is a bridge that reads the row's
  own declaration first, falls back to the side table, unions both, and
  *documents the direction of migration* in place, so the transitional state
  is visibly transitional rather than quietly permanent.

## Declarations can be learned, not only authored

When acquisition includes a discovery flow — something derives a service's
credential shape, probe, or capabilities at runtime — the derivation should
be **saved as a reusable recipe keyed by catalog identity**, so the next
acquisition path reuses knowledge instead of re-deriving it, and so the
catalog surface can indicate "a known-good recipe exists" on the entry
itself. Learned declarations get the same consistency checks as authored
ones; provenance ("authored" vs "discovered, when, by what") rides along so
a later contradiction has an arbiter.

## Roles are for machines; categories are for humans

The two taxonomy axes that get conflated deserve separation. A **category**
answers a browsing human ("communication", "storage", "analytics") and can be
loose, presentational, even operator-editable. A **functional role** answers
a machine ("this composition needs something that can send a message — which
installed connectors qualify?") and must be exact, closed, and stable,
because automation correctness rides on it. Merging them produces either
categories too rigid for browsing or roles too mushy for dispatch. Keep both
columns; let them disagree.

## Audience and licensing live in the row, enforced at one door

Which connectors a given install, plan, or user may *see* and may *use* are
row attributes — but attributes are only half the design. The other half is
that filtering happens at a **single enumeration door** through which every
listing surface obtains rows, so a gated connector cannot leak into one
forgotten picker. Scattered per-surface filtering is the taxonomy version of
scattered validation: correct everywhere except the surface added next
quarter.

## Declarations rot without a consumer that checks them

The standing risk of catalog-as-data is **silent divergence between
declaration and reality**: the row promises an operation the provider
retired, or a probe recipe that no longer matches the declared fields. Code
gets exercised; data gets believed. So every declarative field should name
the mechanism that would notice its lie — the probe exercises the auth
schema, an integration test exercises capability declarations, a seed-time
validation cross-checks intra-row consistency (does the probe reference
declared fields? does every role appear in the closed role set?). A catalog
with no such mechanisms is not wrong yet, but it has no way to find out when
it becomes wrong.
