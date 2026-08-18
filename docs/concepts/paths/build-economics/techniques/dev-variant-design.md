---
layer: technique
subject: build-economics
technique: dev-variant-design
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Dev-variant design

Feature gates (see capability-feature-gating) are the mechanism; the **variant
is the product**. A variant is a named, supported combination of gates,
settings, and profiles that a developer invokes as one command — and the
central design act is choosing the *default*: the variant people run without
thinking, whose cost is the de facto build tax of the whole team. This
technique is about designing that default deliberately, routing work to
variants explicitly, and keeping each variant's blind spots written down.

## The default is a frequency argument

The default variant should cover the overwhelming majority of daily work at
the lowest cost that covers it. The reasoning is arithmetic, not taste: if 95%
of iterations touch surface logic, state, wiring, and storage — and 5% touch
the heavy gated subsystems — then a default that includes the heavy subsystems
taxes 95% of iterations for the benefit of 5%. The correct default is the
*lite* variant, and the correct posture is stated as policy: **default to
lite; switch to full when your task is on the full-only list; the switch costs
one recompile of the gated units.**

Getting the default adopted is part of the design. Developers follow the path
of least surprise: the lite variant must be the shortest command, the one in
the onboarding text, the one example everyone copies. A cheap variant that
exists but is not the default saves nobody anything.

## The routing table

Alongside the variants lives a routing table: *which kind of work needs which
variant*, in one authoritative place, phrased by task rather than by flag
("working on semantic search → full; everything else → lite"). Its absence has
a specific failure signature — a developer either pays for the full build
permanently "to be safe" (the default silently reverts to expensive), or gets
twenty minutes into a lite-variant session before discovering their code path
is compiled out. The table also names the switch cost both ways, because a
developer who knows crossing over costs one bounded recompile treats variants
as a dial; one who has been surprised treats them as a minefield.

One authority, though: the routing table, the variant definitions, and the
build entry points must derive from the same source or reference each other.
A routing table maintained by hand next to independently maintained variant
definitions is two copies of one vocabulary, and they will disagree exactly
when a new gate is added — which is the moment the table is consulted.

## Honest blind spots — documented, not discovered

Every variant below full has blind spots: capabilities that are compiled out,
code paths that cannot execute, integrations that are stubbed. The lite
variant is *honest* when those blind spots are enumerated where the variant is
defined — "this build cannot exercise X, Y, Z" — so a developer verifying a
change knows whether their verification means anything. The dishonest version
is silent: a test that passes on lite because the code under test never ran,
a demo on the lite build that "proves" a gated feature works, a bug closed as
unreproducible because the reproducer needs the full variant. What the cheap
build cannot see must be written down, because a green result on a variant
that cannot exercise the target is a gate that never saw its target.

The same honesty applies to *fidelity* differences short of absence: a dev
profile with optimization off, checks on, and instrumentation enabled has
different timing, different memory behavior, and occasionally different bugs
than the release shape. Performance conclusions drawn on the dev variant are
provisional by default, and the variant map should say so.

## Keeping variants few and alive

Variants multiply combinatorially if allowed — each new axis (gates × profile
× instrumentation × target) doubles the space. Hold the *named, supported* set
to a handful: a lite daily driver, a full variant, possibly a test-focused
variant with instrumentation hooks, and a release shape owned by the release
pipeline. Every named variant carries two ongoing duties: something routine
**builds it** (an unbuilt variant rots into a broken command someone hits at
the worst time), and something **measures it** (each variant has its own cost
curve; the lite variant's advantage over full is a number that should be
re-earned occasionally, because if the gap has collapsed, the complexity of
having two variants is no longer buying anything).

Retire variants that lose their constituency. A variant kept "because it
might be useful" but unbuilt and unrouted is not an option — it is a latent
support incident with a name.
