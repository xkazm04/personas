---
layer: technique
subject: codegen
technique: task-registry-design
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Task registry design

The moment a repository's second generator appears, someone wires both into
the build with an ad-hoc "and then run this too" — and the pipeline is born
as an accident. This technique is the deliberate version: **one flat
registry, readable in one screenful, that is the complete and only
definition of what the pipeline runs.**

## Flat and explicit beats discovered

The registry is a literal list: each task has a name, the exact command it
runs, a time budget, and the named entry-point groups (presets) it belongs
to. The competing design — discovery by convention, where every file in a
directory matching a pattern becomes a task — is seductive because adding a
generator is "free". That freeness is the defect:

- **Joining is invisible.** A discovered task enters the pipeline without a
  diff line saying so; the reviewer approves a new file, not a new build
  step, and nobody decided its budget or its preset membership — those got
  defaulted.
- **Leaving is invisible.** Rename or move a discovered task and it silently
  stops running. Nothing fails: the pipeline runs the remaining set and
  exits clean, which is empty success in miniature
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  With a registry, the dead reference fails loudly at the next run.
- **The audit question is unanswerable by reading.** "What runs, in what
  order, with what budget, triggered from where?" — a registry answers this
  in one file; a discovery scheme answers it only by executing the discovery
  logic in your head, correctly, including its exclusion rules.

A registry line per task also gives each generator an owner-shaped diff: the
commit that added the line is the commit that added the task, and history
answers "when did this join and why" for free. The strongest version carries
a one-line comment per entry naming the incident or need that put the task
there — the registry then doubles as the pipeline's institutional memory,
and a proposal to remove a task must argue with the reason it joined.

## The registry's own blind spot: the unregistered generator

A registry can only vouch for its members. A generator written, shipped, and
never registered is invisible to every audit *of the registry* — and this is
not a hypothetical: measured across one real population, **membership was
the single property separating fresh artifacts from stale ones**. Every
artifact of every registered generator was byte-identical to a fresh run;
most artifacts of the unregistered generators were stale, some catastrophically
so — and no *internal* property of the generators (freshness guards,
compare-before-write logic, do-not-edit headers) predicted anything.
Registration predicted freshness; internals predicted nothing. A generator
only holds the line if something runs it.

So the registry needs an inventory complement, the same move drift gates
need against orphans: enumerate the things that *should* be registered —
every program that writes into a generated output root, or every committed
file carrying a generated-file header — and require each to trace back to a
registry entry. Without that sweep, "the pipeline is complete" is a claim
with no witness, and the completeness erodes one convenient shortcut at a
time.

## Every task declares its outputs

The registry entry names the output root the task writes. Two consequences:

- **No two tasks share an output root.** Two writers to one artifact are two
  authorities for its content
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary));
  the file's final state becomes a function of scheduling, and parallel
  execution — which the pipeline wants for speed — becomes a data race. The
  registry makes the collision reviewable at the moment someone introduces
  it.
- **Declared outputs are what gates and cleanup reason over.** A drift gate
  that knows each task's output root can attribute a stale artifact to the
  generator that owns it; an orphan sweep knows which directories are
  generated ground and which are authored.

## Dependencies are declared, never implied by position

The healthy default is that tasks are **independent** — that is what makes
parallel fan-out safe and failure attribution clean. Where one task
genuinely consumes another's output (a splitter feeding a type deriver, an
inventory feeding a checksum), the registry says so explicitly, and the
runner sequences those two while parallelizing the rest. Encoding the
dependency as list order is a trap with a delay fuse: it holds until someone
alphabetizes the list or the runner goes parallel, and then it fails in the
worst available way — stale *intermediate* input producing plausible,
wrong output downstream. A multi-hop chain also needs its freshness gate on
**every hop**, not just the last; the boundary-contract treatment of that
staleness blind spot is in
[drift-gates](../../ipc-contract/techniques/drift-gates.md).

## Presets: different doors need different subsets

Entry points differ in what they can afford. The interactive door (starting
a development session) wants the fast, high-churn subset; the build door
wants everything; a docs-only door might want one task. The registry names
these groups — each task lists its preset memberships — so an entry point
references a preset by name rather than curating its own task list. The
anti-pattern is per-entry-point lists maintained in the entry points
themselves: those are N hand-maintained copies of pipeline membership, and
they drift the day someone adds a task and updates only the door they
personally use.

## Budgets live in the registry

Each task's time budget is registry data, not runner policy, because tasks
genuinely differ — a catalog scan and a full locale split are different
animals — and because the budget is part of what a reviewer should see when
a task joins. The runner enforces it; the enforcement contract (what a
budget violation means, how it is reported, whether it blocks the door)
belongs to
[generator-failure-isolation](generator-failure-isolation.md) and
[trigger-wiring](trigger-wiring.md).
