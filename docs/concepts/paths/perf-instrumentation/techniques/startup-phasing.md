---
layer: technique
subject: perf-instrumentation
technique: startup-phasing
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Startup phasing

A single startup number is a mood; a phased startup report is a work order.
The technique instruments boot as a **pipeline of named phases with
explicit boundaries**: each phase's start and end stamped by the code that
owns the phase, durations derived from the stamps, and the whole assembled
into one record per launch. When startup regresses — and it regresses, one
small "just do it at boot" at a time — the phased record converts "it got
slower" into "*this phase* got 400ms slower since *that version*", which is
the difference between a complaint and an assignment.

## Phases are owned, and marks are emitted from inside

The phase vocabulary — what the phases are, what each covers, in what order
— is defined once
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
one authoritative list that the emitting code, the report shape, and the
display all derive from. Two reports that disagree about whether "database
ready" includes migrations are not two measurements; they are two
vocabularies.

Each mark is emitted **by the phase itself**, at the moment its own work
completes — never by an outside observer timing the phase from a distance.
The observer guesses at boundaries; the owner knows them. This is the same
site-of-certainty rule as
[semantic-flags-over-heuristics](semantic-flags-over-heuristics.md): the
code that finished the work is the only code that knows it finished, so it
is the only code allowed to say so.

## The finish line is in another process

The deepest error in startup measurement is ending the clock when the
*starting* process is ready. The backend finishing its boot is an internal
milestone; **startup ends when a human can act** — when the interface has
painted, hydrated, and become interactive. In any multi-process
application that moment occurs in a different process from the one that
began the pipeline, so the technique's defining move is the report-back:
the interface process measures its own time-to-interactive against the
shared launch origin and **writes it into the same startup record** the
backend has been filling. One launch, one record, both sides of the
boundary. Without the report-back, the published startup time is the
backend congratulating itself while the user still watches a blank window
— a measurement of the part that was easy to measure.

Two mechanics make the report-back honest: a **shared time origin** (the
launch instant, established once, against which both processes express
their marks — two clocks each measuring "from when I woke up" cannot be
summed), and an **arrival discipline** for the late mark (the record is
open until the interactive mark lands or a deadline passes; a report
printed before then says so).

## A silent phase is missing, never zero

Phases fail to report: a crash mid-boot, a refactor that dropped a mark, a
conditional path that skips a phase entirely. The record renders an absent
mark as **missing** — a distinct state with its own display — never as
zero and never as elided
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)). A
zero says "instant"; an omission says "this phase does not exist"; both
are lies about a mark that was simply never written, and both hide exactly
the launches most worth studying — the broken ones. A skipped-by-design
phase is its own honest state too ("not applicable this launch"), distinct
from missing, because a conditional phase that *should* have run and
didn't is a finding.

## The unattributed gap is a finding

The sum of the phases and the wall clock from launch to interactive will
not match, and the difference is not rounding — it is **unattributed
time**: work happening between marks, in code no phase owns. Render the
gap explicitly. A growing gap means the pipeline's map has drifted from
the territory; the fix is a new phase boundary, not a wider tolerance.
This is the phased report's quiet second job: it doesn't just time the
known phases, it *bounds the unknown ones*.

## The record outlives the launch

A startup record read only at the moment of boot can confirm nothing but
itself. Persist at least the most recent record — better, a short history
— so the questions that matter become answerable: is this launch typical
or an outlier; did the update change the shape; which phase absorbed the
new feature's cost. Cross-run comparison is where phasing pays for
itself; the storage and baseline rules are
[perf-data-lifecycle](perf-data-lifecycle.md)'s.
