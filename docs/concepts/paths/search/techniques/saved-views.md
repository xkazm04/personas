---
layer: technique
subject: search
technique: saved-views
status: forged
laws: [identity-survives-reuse, failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Saved views

A saved view promotes ephemeral surface state — query text, filters, sort,
sometimes display configuration — into a named, durable, recallable artifact.
It is the answer to a user rebuilding the same five-clause filter every
morning, and it is the point where search state stops being session data and
starts being a small schema of its own, with the lifecycle obligations that
implies.

## A view stores the predicate, not the results

The defining decision: a view is a *question*, saved so it can be asked
again. Applying a view re-executes the query against the current corpus;
yesterday's saved "failures this week" shows today's failures. The other
artifact — a frozen result set captured at a moment — is a *report* or a
*snapshot*, a different feature with different storage, staleness, and
sharing semantics. Conflating them produces the worst of both: users who
expect live results get stale ones, or users who expected a stable record
watch it shift. Build the one the product needs; name it honestly.

What the predicate includes is a contract to decide once: query text and
filters always; sort usually; column/display configuration when the view is
meant to reproduce a *workspace* rather than just a slice. Persist the
**parsed, typed form** of the state (typed filter clauses, the free-text
term) rather than a raw input string — recalling a view must not depend on
re-parsing text under a grammar that may have evolved since it was saved.

## Identity, name, and mutation

A view's identity is minted at creation and never derived from its name
(identity-survives-reuse): renaming "triage" to "morning triage" must not
orphan the shortcut, the default-view pointer, or the shared link that
referenced it. Around that identity, a small set of semantics that every
implementation must answer explicitly:

- **Dirty state.** The user applies a view, then tweaks a filter. The surface
  is now *near* the view but not *at* it, and must show the divergence — a
  modified marker on the view's name — and offer the three exits: update the
  view, save as new, revert. Silently mutating the saved view on every tweak
  destroys its value as a stable landmark; silently ignoring the divergence
  gaslights the user about what they are looking at.
- **The default view is a view.** If the surface opens with a preset slice,
  that preset is a view like any other — visible, inspectable, and
  restorable after the user wanders. A hardcoded implicit default plus named
  saved views is two systems where one suffices.
- **Personal versus shared.** A personal view mutates freely under the dirty
  -state rules. A shared view is a published artifact: edits affect other
  people, so either editing is restricted to an owner, or edits fork into
  the editor's personal copy (save-as by default). Deciding this after
  shipping sharing is deciding it during an incident.

## Schema drift: the view outlives what it references

A saved view references fields, vocabularies, and entities that continue to
evolve after it is frozen. A filter on `status: reviewing` is a bet that the
status vocabulary keeps a `reviewing` value; a sort on a column is a bet the
column survives. The bets eventually lose, and what happens next separates
robust implementations from silent ones:

- **Validate at application time, against the live schema** — the same
  single authority the rest of the system reads (one-authority-per-
  vocabulary), not a copy of the schema captured when the view was saved.
- **A clause that no longer binds degrades visibly, never silently**
  (failure-not-empty-success). The catastrophic variant is the silent drop:
  a retired-field clause quietly removed *widens* the result set — the view
  named "unresolved escalations" starts including resolved ones, and the
  user, trusting the name, acts on wrong data. Render the dead clause as
  broken (visible, marked, non-matching or explicitly ignored with a
  warning), and offer repair or removal as a user action.
- **Migrations may rewrite views** when a vocabulary renames a value or a
  field splits, but the rewrite is a deliberate migration with the same care
  as any data migration — enumerable, logged, reversible — not an on-read
  patch scattered through the application path.

## Lifecycle and placement

Views are user data: they participate in export, backup, and deletion like
any other user artifact, and a view attached to a scoped context (a project,
a team) states what happens when the scope is archived or deleted — cascade,
orphan-and-flag, or block — at design time (the question "who deletes this?"
answered at creation).

Placement follows recall: views the user returns to daily earn a position in
primary navigation (pinned tabs, a sidebar section) where they behave as
destinations; the full library lives one level deeper. A view that is easy
to create and hard to find again teaches users to stop saving them —
adoption of this feature is a direct read on whether recall was designed or
merely stored.
