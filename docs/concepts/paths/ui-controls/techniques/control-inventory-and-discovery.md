---
layer: technique
subject: ui-controls
technique: control-inventory-and-discovery
status: forged
laws:
  - derivation-names-recomputation
  - gate-sees-target
shared_with: []
---

# Control inventory & discovery

A shared primitive earns its keep only at one moment: the instant a developer
is about to build the thing it already is. If the library cannot answer
"does this exist?" *at that moment, in seconds*, the developer builds — and
the answer arrives later as a shadow copy in a code review, or never. This
technique is the routing layer: the inventory, the catalog that publishes
it, and the tables that meet the developer at the moment of temptation.

## The catalog is generated, never hand-curated

A hand-maintained component list is stale by construction: it is a derived
view of the source tree with no recomputation path, and it drifts precisely
when someone adds a primitive and forgets the list — which is the moment the
list existed for ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
The correct shape:

- **Annotations in the source are the input.** Each primitive carries a
  one-line catalog tag in its own doc comment — what it is, in the words a
  searcher would use. The tag lives next to the code so renaming, moving, or
  deleting the component takes its catalog entry with it.
- **A generator walks the tree and emits the catalog.** The catalog file
  states, in its header, that it is generated and by what — so nobody edits
  it by hand and nobody wonders whether it is current.
- **Regeneration is wired into the routine builds**, so freshness is a
  side effect of working, not a chore. Whether staleness additionally
  *fails* a gate is a real decision with a real trade-off: a hard gate keeps
  the artifact perfectly fresh but fires on every unrelated commit that
  touches a primitive; a soft gate (regenerate-on-build, audit on demand)
  accepts bounded staleness in exchange for never training people to bypass
  it. Either is defensible; what is not defensible is a hand-edited catalog
  or a gate that checks a proxy of the tree instead of the tree
  ([gate-sees-target](../../_laws.md#gate-sees-target)).

## Entries answer the searcher's question

A catalog entry is not documentation; it is a *routing decision aid*. Each
entry needs exactly: the name, the one-line contract ("busy-state button —
ties the spinner to the promise you return"), the import path, and — when
the primitive is a trap or a shim — the warning in the entry itself. A
primitive whose honest entry is "renders nothing; compatibility shim" must
say so in the catalog, because the catalog is where the next confused
adopter will look first.

## Route by temptation, not by name

The alphabetical component list answers "what is CopyButton?" — a question
nobody asks before hand-rolling. The question actually asked is "I need to
put text on the clipboard"; the router must be keyed by that. The highest
value discovery artifact is the **don't-hand-roll table**: left column, the
thing you are about to write (a raw clipboard call, a hand-painted modal
backdrop, a checkbox styled as a switch, a `title=` tooltip, a locale-naive
timestamp); right column, the primitive that already is that thing. It lives
in the instructions every developer and coding agent reads before writing
code — not in a wiki nobody opens mid-edit. Every shadow copy found later is
a missing or unread row in this table; treat the table as the artifact the
adoption loop feeds (see
[adoption-enforcement](adoption-enforcement.md)).

## Placement rules keep the catalog trustable

Discovery collapses if the primitives tree fills with things that are not
primitives — a catalog of two hundred half-domain widgets routes nobody. The
rules:

- **The shared tree holds domain-free primitives only.** No feature
  vocabulary, no app-state imports, no business logic. A component that
  needs app state takes it through props or lives with its feature.
- **App chrome is shared but separate** — the shell's own furniture
  (navigation bars, global toasts, command surfaces) is reused but not
  *reachable-for*; cataloguing it beside the primitives buries them.
- **Domain components live with their domain.** A wrapper that presets a
  primitive for one feature belongs to that feature, not to the library.
- **Curation is a deliberate, recorded act.** Pruning the catalog from
  everything-anyone-shared down to the true primitive set is worth doing,
  and worth writing down — the count will drift afterward, and the next
  census needs to know what the number meant when it was set
  (a count carries its predicate).

The boundary can be advisory (a warning when the shared tree imports from a
feature) rather than build-failing — placement is a judgment call more often
than the other rules in this subject — but it must at least be *visible*,
or the tree decays silently between curations.

## The zero-adopter signal

The inventory is also a mirror. Cross the catalog against usage and three
populations appear: adopted primitives (healthy), shadow-copied primitives
(a routing or contract failure — see
[adoption-enforcement](adoption-enforcement.md)), and **zero-adopter
primitives** — built, catalogued, and never used. A zero-adopter primitive
is not a reserve; it is unverified code presented as a standard, and its
existence in the catalog costs trust. Either route real consumers to it
within a curation cycle or remove it from the catalog and say why.
