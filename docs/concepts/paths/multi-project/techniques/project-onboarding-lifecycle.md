---
layer: technique
subject: multi-project
technique: project-onboarding-lifecycle
status: forged
laws: [one-validation-door, derivation-names-recomputation, creation-names-reaper, one-authority-per-vocabulary]
shared_with: []
---

# Project onboarding and lifecycle

A portfolio is only as trustworthy as its edges: how projects become
managed, and how they stop. Both edges are **doors with contracts**, not
events that merely happen — because everything between the edges (walls,
scores, signals, comparisons) assumes the door did its job.

## Admission is a door, and it equips

Nothing becomes managed except through the one admission door
([one validation door](../../_laws.md#one-validation-door)). Admission does
three things, in order:

1. **Mints identity** and fingerprints against the registry for duplicates —
   the mechanics live in
   [project-identity-and-joins](project-identity-and-joins.md).
2. **Binds the mutable facts** as re-bindable fields: location on disk,
   remotes, display name, owner.
3. **Equips the project with its metadata contract** — and this step is
   what separates a managed project from a name on a list.

The **metadata contract** is the declared set of artifacts the manager
maintains about every project it manages. A typical contract:

- a **structure map** — the project's areas/contexts, which everything
  that scopes work ("touch only this area") reads;
- a **dimension scorecard** — scores against the portfolio's shared
  dimension registry (see
  [cross-project-comparison](cross-project-comparison.md));
- a **readiness record** — the passport-style checklist of what the
  project has and lacks operationally;
- **knowledge artifacts** — conventions, glossaries, agent-facing
  instructions that tools working inside the project will consume;
- a **signal subscription** — watchers registered over its exhaust (see
  [passive-signal-ingestion](passive-signal-ingestion.md)).

Admission is complete when each contract item is either **populated or
explicitly deferred with a visible gap** — never silently absent. The
distinction runs the whole portfolio: a deferred item renders as a gap the
wall can flag and a plan can schedule; a silently absent one renders as a
hole every downstream surface papers over differently. Populating the
contract is real work (scans, scoring runs, generation), so admission is
usually a *process* with resumable progress, not a single transaction — but
its completion criterion is binary and checkable.

## Every artifact names its refresher

Each contract artifact is a stored derivation of the project's actual state,
and the project keeps changing after admission. So every artifact carries
**what re-derives it and on what trigger** — a scheduled re-scan, a
staleness threshold, a signal-driven prompt ("unusually heavy change volume
since the map was built — refresh?")
([derivation names recomputation](../../_laws.md#derivation-names-recomputation)).
The stale structure map deserves its own warning, because its failure is
*active*: work scoped against an outdated map is mis-sized silently — plans
land plausible and wrong, and nothing errors. An artifact without a named
refresher is not metadata; it is a photograph aging into a caricature. Where
the manager cannot refresh an artifact itself, the honest fallback is a
displayed age — "mapped 94 days ago" changes how a reader weighs the map,
which is the entire point.

Two refinements make refreshing operable rather than aspirational. **The
staleness verdict belongs at the consent moment:** compute the freshness
gates where the decision is made and show them in the confirmation itself —
"structure map: three months old, will re-derive incrementally" is the
sentence that makes the run's cost predictable before it is approved, and
the manager can usually derive those verdicts in one cheap read where the
refresh tooling would spend real work rediscovering them. **Refresh runs
are scopeable by lane:** the contract's artifacts refresh independently
(map, scores, readiness, knowledge), the operator picks a subset, and a
lane left out is reported *out of scope* — a named non-result, never a
silent absence a later reader mistakes for freshness.

## The lifecycle vocabulary is closed

A project's management state comes from one small closed set
([one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)),
single-sourced and consumed by every surface. A workable minimum:

- **candidate** — visible to the manager, not yet admitted; nothing is
  maintained about it.
- **onboarding** — admitted, identity minted, contract population in
  flight; surfaces show progress, not pretend-completeness.
- **active** — contract populated (or gaps explicit), watchers running,
  fully comparable.
- **paused** — deliberately not being watched or scored (a known hiatus);
  distinct from broken, distinct from archived.
- **archived** — out of management, record preserved.

Transitions pass through the registry's door, per the general shape in
[entity-lifecycle](../../entity-lifecycle/entity-lifecycle.md); the states
that earn their place here are *onboarding* (because contract population is
long enough to be observable) and *paused* (because "we chose not to look"
must never be spelled the same as "we cannot look" — the watch layer's
unwatched verdict — or the same as quiet).

## Archival preserves; removal enumerates

**Archival is a state, not a deletion.** The identity, score history, pulse
archive, and notes survive; comparisons exclude archived projects by default
but can include them on request ("how did we do on the ones we finished?").
The transition itself is where running concerns stop: watchers deregistered,
tabs closed or disabled, scheduled scans cancelled — each named at the
moment of archival, because unowned leftovers from departed projects are the
portfolio's characteristic leak
([creation names its reaper](../../_laws.md#creation-names-reaper)).

**Un-archival restores the same entity** — same key, history intact,
watchers re-registered, artifacts refreshed (not trusted: the project lived
unobserved). Re-admitting a formerly archived project through the duplicate
check must find the archived entity and offer restoration; minting a fresh
twin next to a rich archived history is the identity defect at its most
expensive.

**Removal** — actually deleting the record — is rare and enumerates before
it acts: what artifacts, histories, states, and registrations will be
destroyed, shown, confirmed. A portfolio that can silently forget a project
it managed for a year will eventually do it to the wrong project.
