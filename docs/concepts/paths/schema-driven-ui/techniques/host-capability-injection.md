---
layer: technique
subject: schema-driven-ui
technique: host-capability-injection
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Host capability injection

The renderer is a pure function of two inputs — the validated spec and a
**capability object** the host constructs and hands in. Everything the
rendered surface can *do* or *fetch* flows through that object: data loaders,
action handlers, navigation, formatting and localization, live-data
subscriptions. The renderer itself imports nothing from application state,
reads no global store, and issues no requests of its own devising.

## Why store-freedom is a hard rule, not a style preference

- **Testability.** A store-free renderer renders any spec against stub
  capabilities in a plain test: hand it a document and a fake fetcher, assert
  the tree, the drop disclosure, the disarmed actions. The moment the
  renderer reaches into ambient state, every test drags the application's
  world along, and the specs-as-fixtures workflow — the cheapest way to pin
  rendering behavior — dies.
- **Portability.** The same renderer must serve every host that wants
  spec-driven surfaces: the full desktop pane, a compact companion view, a
  preview harness, an export path. Hosts differ in exactly the things the
  capability object abstracts; a renderer bound to one host's store is a
  renderer with one host.
- **Least privilege.** The capability object is the complete inventory of
  what a spec can reach. Security review of the spec channel reduces to
  reviewing one interface per host — not auditing a component tree for
  ambient imports. A hostile spec cannot request a capability the host never
  constructed.

## The capability surface is the second closed vocabulary

Like node kinds and action ids, the capability interface is finite, named, and
versioned. Registered components declare which capabilities their kind
consumes; the declaration is checkable, so "which kinds could touch live data"
is a query, not an audit. Growth is deliberate: a new capability is an
interface change reviewed as one, because every capability added is authority
every future spec-rendered surface holds.

Two disciplines keep the interface honest:

- **Capabilities are semantic, not transport.** `loadEntitySummary(id)`, not
  a generic request-issuing function. A generic escape hatch ("fetch any
  endpoint") in the capability object is the store dependency returning with
  extra steps — and it hands the spec channel the host's full reach.
- **Capabilities carry their failure shape.** Each capability defines what
  unavailable, denied, and failed look like, so registered components render
  their designed degraded states instead of throwing across the containment
  boundary.

## Missing capabilities degrade the node, not the surface

A host may legitimately inject a subset — the export host has no navigation,
the preview harness has no live data. A kind that needs an absent capability
renders its designed "unavailable here" state at its own geometry, and the
surface stays coherent. Kinds probe the object they were given; they never
assume the full set. This is the same per-node containment rule the registry
imposes for failures ([registry-mapping](registry-mapping.md)), applied to
authority instead of errors — and it is what makes one spec portable across
hosts of different power.

## Live capabilities name their reaper

Capabilities that open ongoing resources — subscriptions, watchers, polling
loops — are created through the capability object and must be torn down by
it: the subscription handle returned to the node names its disposal, and the
renderer guarantees disposal runs when the node leaves the tree (a spec
re-render, a repair pass dropping the node, the surface unmounting). A
spec-driven surface is *recomposed* far more often than a hand-built one —
every agent update replaces the tree — so an undisposed subscription per
recomposition is a leak with a fast clock. The capability contract states, per
live capability, what destroys it and when; "who deletes this?" is answered at
the interface, not rediscovered per kind.

## Construction happens at the host boundary, once

Each host assembles its capability object in one place — binding real
services, applying its policy (what this surface may reach), and stamping
provenance for the audit trail that
[action-consent-wiring](action-consent-wiring.md) requires. One construction
site per host keeps the authority grant reviewable and keeps capability
drift — two surfaces in one host wired with subtly different powers — from
happening by accident.
