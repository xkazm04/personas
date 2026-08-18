---
layer: technique
subject: usage-analytics
technique: coverage-from-registries
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Coverage from registries

Analytics coverage — the list of surfaces the system measures — must be
*derived* from the product's own authoritative registries, never maintained
as a parallel list. This single structural decision eliminates the most
expensive failure in usage measurement: the surface that ships unmeasured and
therefore invisibly, indefinitely, produces the same signal as a surface
nobody uses.

## The drift problem is disciplinary, so the fix must be structural

A hand-maintained tracked-surface list is correct on the day it is written
and decays from the first release after. Every new section, tab, or feature
requires someone to remember the analytics list — and the person adding a
surface is thinking about the surface, not about measurement. The failure is
silent twice over: the code works, the pipeline works, and the report simply
has no row for the new thing. Nothing red appears anywhere. Review checklists
and team discipline slow the decay; they never stop it, because the mechanism
is *forgetting*, and forgetting is what discipline is made of.

The structural fix: the product already owns a machine-readable map of its
surfaces. The [app shell](../../app-shell/app-shell.md)'s navigation registry
— the closed vocabulary of sections and sub-destinations that the
[navigation model](../../app-shell/techniques/navigation-model.md) maintains
as its single authority — *is* the list of visitable surfaces. The analytics
layer imports it; it does not transcribe it
([law: one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)).
A surface added to the shell is in the measurement frame the same commit,
with no analytics-side change, because there is no analytics-side list to
update.

## The catalog is a projection, not a copy

The analytics layer usually needs its own view of the registry — stable
tracking ids, a flag for surfaces that are reachable but not independently
meaningful, grouping for reports. Build that view as a **projection computed
from the registry**, or, where a static catalog is unavoidable, guard the
pair with an **exhaustiveness check that fails the build** when the registry
gains an entry the catalog lacks. The distinction matters: a copy plus a
checker is drift *detected*; a projection is drift *impossible*. Prefer
impossible; accept detected only where the projection genuinely cannot be
computed. What is never acceptable is a copy with no gate — that is the
hand-maintained list wearing the registry's clothes, and the gate must watch
the real registry, not a snapshot of it
([law: a gate must see its target](../../_laws.md#gate-sees-target)).

One trap deserves its own sentence, because it recurs wherever the guard is
partial: **an exhaustiveness check closes only the axis it encodes.** A guard
that forces every *value* of a declared dimension to be listed does nothing
about *which dimensions are declared* — an omitted surface simply moves from
the axis the check watches to the axis it cannot see, and the miss looks
identical to before. Coverage has as many axes as the surface space has levels
(sections, their tabs, the list of tab dimensions itself); each axis needs its
own derivation or its own gate, and the audit question is "which axis is still
a hand-maintained list?", asked until the answer is none.

Gated surfaces need one decision made explicitly: a section hidden from this
user by entitlement or platform is *out of this user's denominator* — its
zero means "not offered", not "ignored" — while a section offered and never
opened is the finding. The projection carries the distinction so reports can.

## Visited and ignored are one report

Deriving coverage from the registry is what makes the negative space
reportable at all. The report's frame is the full surface list; observed
counts are joined onto it; **absent rows become explicit zeros**. The output
always has exactly as many rows as the registry has surfaces, split into:

- **visited** — surfaces with observed activity, with their counts;
- **ignored** — surfaces offered to the user this period with zero visits,
  enumerated by name, not summarized as a count of misses.

An ignored surface is a *positive finding* — "offered N sessions, opened
zero" — and it must be structurally impossible for a surface to fall out of
the report entirely. A report that lists only observed events cannot
distinguish "unmeasured" from "unused"
([law: failure spelled differently from empty success](../../_laws.md#failure-not-empty-success));
a registry-framed report makes "unmeasured" a state that cannot exist.

## Coverage of the vocabulary itself

The same derivation discipline applies one level up: the visit and activation
events for every surface should be emitted by **shared plumbing keyed off the
registry** — the navigation door records `section_visited` for whatever
section the model transitions to — not by per-surface calls sprinkled into
each screen. One emit site per event class means a new surface cannot forget
to instrument itself, because no surface instruments itself. Per-surface
analytics code should be as rare as per-surface routing code: a smell unless
argued for.

## What this does not cover

The registry covers *navigable* surfaces. Products also have measurable
moments with no registry — flows, gestures, states. Where such a moment earns
an event (see [event-taxonomy](event-taxonomy.md)), it re-enters coverage
discipline by being declared in the event registry, which is itself a closed
list the report can enumerate. The rule generalizes: **every measured thing
belongs to some enumerable authority, and every report frames itself with the
authority's full list, never with the set of things that happened to emit.**
