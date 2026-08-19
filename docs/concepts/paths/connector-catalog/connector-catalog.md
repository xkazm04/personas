---
layer: golden-path
subject: connector-catalog
status: forged
techniques:
  - catalog-as-data
  - shipped-vs-operator-ownership
  - schema-driven-forms
  - matching-and-ranking
  - adapter-normalization
  - catalog-lifecycle
evidence:
  - src/lib/credentials/builtinConnectors.ts                    # seed catalog: one JSON row per service, category-tag union, matching helpers
  - scripts/connectors/builtin/slack.json                       # anatomy of a row: fields + sensitive flags, {{field}} probe template, resources with declarative pagination
  - src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx   # one renderer, N declarations; orphan-row rollback on failed save
  - src/features/templates/sub_n8n/edit/connectorMatching.ts    # tiered matching with minimum-signal guard and ambiguity refusal
  - src/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters.ts        # four heterogeneous observability APIs behind one view model
  - src/lib/credentials/connectorRoles.ts                       # functional roles as a closed vocabulary, separate from browse categories
counter_evidence:
  - src-tauri/db/src/lib.rs                                     # seed_builtin_connectors' boot refresh — the measured clobber (deferred-fixes §127)
deviations:
  - w11-connector-catalog   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - deferred-fix-127   # golden-path-deferred-fixes.md §127 — boot refresh overwrites nine columns of every shipped row; operator edits revert, updated_at lies
  - deferred-fix-126   # golden-path-deferred-fixes.md §126 — three probes reference no declared field; green for any typed value, and Save is gated on that green
---

# Connector catalog & API adapters

A product that integrates with many external services needs a place where it
**knows things about services it does not operate**: what they are called, how
they authenticate, what they can do, how to check that a stored credential
still works, who is allowed to see them, and how their wildly different APIs
map onto the product's own concepts. That place is the connector catalog — a
declarative registry with one entry per **integration type**, consumed by
every surface that touches the outside world: the browse-and-connect gallery,
the credential form, the health probe, the import matcher, the adapter
dispatch, the licensing gate.

The subject is the **knowledge layer**, and its boundary is worth drawing
precisely. It is not the [credential vault](../credential-vault/credential-vault.md) —
the vault holds *instances* (this user's key for that service, sealed and
brokered); the catalog holds *types* (what a key for that service looks like
at all). It is not the outbound door that applies credentials to requests —
that door *consults* the catalog for base addresses and auth strategies but
belongs to the vault's custody story. And it is not the generic
[form](../form/form.md) or [schema-driven-ui](../schema-driven-ui/schema-driven-ui.md)
machinery — the catalog *feeds* those with declarations. The catalog's own
job is narrower and more valuable: **one authoritative description per
external service, from which everything else is derived.**

## The catalog is data, and the row is the unit of shipping

The formative decision is that a supported service is a **row, not a branch**.
Every integration the product understands is described in a uniform record —
identity, presentation, credential shape, capabilities, probe recipe,
taxonomy — and the surfaces that consume integrations are written once,
against the record shape, never against any particular service. Adding the
forty-first service is then a data change reviewable by a non-engineer;
special-case code is reserved for the minority of services whose *behavior*
genuinely diverges, and even that code hangs off the row rather than replacing
it. What earns a place in the row, and the test for when a service has earned
code instead, is the [catalog-as-data](techniques/catalog-as-data.md)
technique.

Two properties of the row deserve to be called out as the subject's load-bearing
walls:

- **Identity is a stable machine key, minted once.** Every credential
  instance references its type by this key; every adapter dispatches on it;
  every imported workload resolves to it; every audit line names it. The key
  is not the display label (labels get renamed), not the vendor's marketing
  name (those get rebranded), and not an ordinal (catalogs get resorted). A
  catalog whose consumers key on anything but the minted identity breaks the
  first time the presentation layer is edited.
- **Declarations are contracts, not documentation.** The row's auth schema is
  what the credential form renders, what validation enforces, what the probe
  substitutes into, and what redaction consults. The row's capability lists
  are what downstream features branch on. If a surface hand-maintains its own
  copy of any of these — its own field list, its own service list — the copy
  drifts exactly when a row is edited, which is the one moment agreement
  matters.

## Two writers own the same table

The catalog has a property most registries do not: **it is written by two
parties with different lifecycles.** The vendor ships rows and must be able to
update them — a corrected auth schema or a fixed probe has to reach every
existing install, or shipped bugs become permanent. The operator edits rows —
renames, recategorizes, adjusts fields for a self-hosted variant — and must be
able to trust that edits stick. Both requirements are legitimate; naive
designs satisfy exactly one.

The canonical failure is the **re-seeding clobber**: a boot-time refresh that
unconditionally rewrites shipped rows, silently reverting every operator edit
on every start — and, if it also stamps the modification timestamp, destroying
the evidence that an edit ever existed. This repo carries a fully measured
instance of exactly that (see the deviations register): a refresh that rewrote
nine columns of every shipped row on every launch, where the one operator
customization that survived did so only because its column was accidentally
missing from the rewrite list. An ownership contract that is an accident of a
hand-maintained column list is not a contract. The deliberate version —
column-level ownership, revision-gated refresh, edits detectable and
mergeable — is the
[shipped-vs-operator-ownership](techniques/shipped-vs-operator-ownership.md)
technique, and it is the single most transplantable lesson this subject
offers: every product that ships defaults into a user-writable store faces it,
whether the rows are connectors, templates, rules, or dashboards.

## The auth schema drives the form — and the probe must exercise it

Credential acquisition is where the catalog earns its keep in the UI. The row
declares the credential's shape — which fields, which are secret, which are
optional, what help text — and a single generic form renders any connector
from that declaration. Per-service customization (a guided token walkthrough,
a discovery step, an unusual widget) enters through a **registered override
keyed by connector identity**, not by forking the form; the override handles
presentation while the declaration remains the authority on shape. This is
[schema-driven-forms](techniques/schema-driven-forms.md).

The same declaration must reach the health probe, and this coupling has a
sharp failure mode worth naming at the golden-path level: a probe that never
references any declared field returns green **for any value the user types**,
and if saving is gated on probe success, the vacuous green is precisely what
admits broken credentials into the vault. This too is measured in this repo
(see the deviations register): of the connectors declaring a probe, three
declared a credential field their probe never sent, and the save button
waited on exactly that meaningless green. A gate must see its target; a
connection test that does not send the credential tests the network, not the
credential. Probe mechanics themselves belong to
[health-checks](../health-checks/health-checks.md) and the vault's probing
technique; what belongs *here* is the alignment obligation — declaration,
form, and probe are three readers of one schema, and the catalog is where the
schema lives.

## Foreign names must resolve to catalog identity — honestly

Work arrives naming services in vocabularies the catalog does not control: an
imported automation names its steps in a foreign tool's terms, a user types a
fragment into a picker, a directory listing offers near-duplicates. Resolution
from foreign name to catalog identity is a **ranked matching** problem with
two honesty obligations: a confident match must outrank a plausible one by
tiers (exact identity, then alias, then normalized-token overlap), and *no
match* must be a first-class outcome — distinct from a weak match, never
papered over by returning the least-bad candidate. The classic defect is the
**vacuous match**: normalization strips a short or generic token down to
something that matches half the catalog, and the ranker dutifully returns its
top hit. Guards against that — minimum-signal thresholds, ambiguity surfaced
as a choice rather than resolved by luck — are the
[matching-and-ranking](techniques/matching-and-ranking.md) technique. (The
wider problem of ingesting a foreign tool's artifacts wholesale is its own
subject, import-normalization; this technique is the identity-resolution
slice the catalog owns.)

## Adapters normalize; the catalog doesn't pretend they aren't needed

Declarative rows carry the subject a long way, but some integrations differ
in *shape*, not just in parameters: one provider pages with cursors and
another with offsets; one reports usage per-model and another per-account;
one returns a document tree where another returns flat records. Pretending
rows alone suffice produces conditionals scattered through every consumer —
the catalog's benefit reversed. The disciplined escape hatch is the
**adapter**: per-provider code that maps a heterogeneous API onto one
internal view model, registered under the catalog identity, thin enough to
contain only translation (never policy), and honest about gaps via capability
declarations rather than silent zeroes. Designing the view model from
consumer needs first — then making every adapter meet it — is
[adapter-normalization](techniques/adapter-normalization.md).

## Rows are born, evolve, and must be able to die

A catalog that only ever grows becomes a graveyard with a search box. Entries
get superseded, providers shut down, two rows turn out to be one service under
different names. Because credential instances, automations, and audit history
all reference catalog identity, retirement is never a bare delete — it is a
lifecycle with tombstones, alias redirects for dedupe, and migration or
explicit orphaning for dependents. The shipped side needs the mirror-image
discipline: when an entry leaves the shipped catalog, something must compute
the set difference against installed rows, or retired entries live on in
every existing install forever, indistinguishable from supported ones. Version
stamps, retirement, aliasing, and dependent migration are the
[catalog-lifecycle](techniques/catalog-lifecycle.md) technique.

## What good looks like

A healthy connector catalog passes these checks:

1. **Adding a mainstream service touches zero consumer code** — one row (and
   at most one registered override or adapter) lights up discovery, forms,
   probing, and matching simultaneously.
2. **Every consumer keys on minted identity**; renaming a label breaks
   nothing.
3. **The ownership contract is explicit** — for every column, you can say
   whether vendor refresh or operator edit wins, and the refresh is gated so
   the answer is enforced rather than remembered.
4. **The auth schema has one home** and the form, validation, probe, and
   redaction all demonstrably read it — a probe that references no declared
   field is a detected defect, not a green light.
5. **Matching says "no"** — unresolvable foreign names surface as
   unresolved, and short tokens cannot vacuously claim the catalog.
6. **Retirement is reachable** — there exists a path by which a shipped entry
   leaves existing installs, with its dependents accounted for.

## The techniques

- [catalog-as-data](techniques/catalog-as-data.md) — what belongs in the row:
  identity, presentation, auth schema, capability declarations, probe recipe,
  and taxonomy (category, functional roles, audience, licensing); the
  row-vs-code boundary test.
- [shipped-vs-operator-ownership](techniques/shipped-vs-operator-ownership.md)
  — two writers, one table: column-level ownership, revision-gated refresh,
  and why the boot-time clobber is the canonical failure.
- [schema-driven-forms](techniques/schema-driven-forms.md) — one declaration
  rendering every credential form; registered per-connector overrides; the
  declaration–probe alignment obligation and the vacuous green.
- [matching-and-ranking](techniques/matching-and-ranking.md) — resolving
  foreign names to catalog identity: tiered ranking, normalization, aliases,
  minimum-signal guards, and no-match as a first-class outcome.
- [adapter-normalization](techniques/adapter-normalization.md) — one view
  model over heterogeneous provider APIs: consumer-first model design, thin
  registered adapters, capability flags over silent gaps.
- [catalog-lifecycle](techniques/catalog-lifecycle.md) — versioning,
  retirement with tombstones, dedupe by aliasing, and migrating the records
  that reference a dying row.
