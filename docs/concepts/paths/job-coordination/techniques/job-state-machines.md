---
layer: technique
subject: job-coordination
technique: job-state-machines
status: forged
laws: [one-authority-per-vocabulary, one-validation-door, failure-not-empty-success]
shared_with: []
---

# Job state machines

Everything else in the subject — leasing, resumability, recovery,
observability — presupposes that "what state is this job in?" has exactly one
well-defined answer. That is not a property systems have by default. It is
manufactured by three decisions made early: a closed vocabulary with one
authority, an explicit transition relation, and a single door through which
every transition passes. Skip any of the three and the later machinery
degrades in a characteristic way: leases with nothing definite to expire
*into*, recovery that cannot enumerate what it must recover, dashboards that
disagree with the store they render.

## The vocabulary is closed and has one authority

The status set is an enum, defined once, and every consumer — the store
schema, the executor, the recovery sweep, the UI badge map, the metrics
rollup — derives from that one definition
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The characteristic failure is not a missing state but a *near-duplicate*:
one component writes `canceled`, another matches `cancelled`; a new
`expired` state ships in the writer and the recovery sweep's `NOT IN
(terminal…)` list doesn't learn about it, so expired jobs become the exact
limbo the state was invented to eliminate. A closed vocabulary is closed at
one address or it is not closed.

Two encodings that masquerade as state machines, and are not:

- **Composed booleans** — `is_running`, `is_done`, `was_cancelled` — create
  2^n representable combinations of which most are illegal, and every reader
  re-derives the state with its own precedence rules. The illegal
  combinations *will* be reached; booleans have no transition relation to
  stop them.
- **Sentinel columns** — "`finished_at` is null means it's still running" —
  conflate a timestamp's absence with a state's presence. The moment a
  second nullable column joins (`cancelled_at`, `expired_at`), state becomes
  a decision tree over nulls that no two readers implement identically.

Both encodings also make the closed-vocabulary law unenforceable: there is
no single place where the set of states even *exists*.

## Transitions are enumerated, and one door enforces them

The legal-transition table — which states may move to which, and on whose
authority — is written down next to the vocabulary, and enforcement lives in
**one transition door**: a single operation that takes (id, expected-from,
to, reason, actor) and refuses anything the table forbids
([one-validation-door](../../_laws.md#one-validation-door)). Writers
scattered across the codebase flipping the status column directly are the
state-machine equivalent of validation sprinkled across call sites: the
machine holds until the write site added next quarter, which will be written
by someone who has never seen the table.

The door's mechanics are a conditional write — *set to X where id matches
and state is still Y* — because between any read and any write, someone else
may have moved the job. The mechanics, the election semantics, and the
politeness protocol for losing are
[atomic-claiming](../../delivery-guarantees/techniques/atomic-claiming.md)'s;
what this technique adds is scope: **every** transition goes through the
conditioned door, not just the claim. A completion write unconditioned on
"still running, still mine" will happily overwrite the verdict a recovery
sweep issued while the slow executor was busy finishing.

## State classes: live, paused, terminal

Every state belongs to one of three classes, and the class determines what
the rest of the subject does with it:

- **Live** (queued, running): an executor is expected to be advancing this,
  and evidence of that expectation — a lease, a heartbeat — must exist. A
  live state with stale evidence is the definition of *stuck*.
- **Paused** (awaiting input, awaiting approval, scheduled-for-later): the
  job is deliberately not executing, and the record names **what it is
  waiting for**. Paused states are healthy at any age. A machine without
  paused states will misuse a live state to represent waiting — and then
  every stuck-detection threshold has to be stretched until it also misses
  actual corpses.
- **Terminal** (completed, failed, cancelled, expired): final, verdict
  attached, no exits. The distinctions matter downstream — "completed with
  zero items," "failed," and "cancelled" are three different facts and must
  never collapse into one gray endpoint
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

The classification is worth making explicit in code (a function from state
to class), because recovery, expiry, and observability all branch on the
class, and a new state that never gets classified is a new hole in all
three.

## Transitions carry reason, actor, and time

The transition door writes not just the new state but **who** moved it
(executor id, recovery sweep, operator, expiry policy), **why** (a typed
reason token, not free prose), and **when**. This trail is what makes the
record debuggable after the fact: a job that ends *failed* via three
retries, a lease expiry, and an operator requeue tells that story from its
transitions alone. Context evaporates minutes after an incident; the door is
the only participant guaranteed to be present at every transition, so the
door records it.

## Decision rules

- **Mint identity at creation, in the record.** The job id is created when
  the record is, survives every restart and re-claim, and is the key for
  everything downstream. An id derived from the executor (a process-scoped
  handle, a channel id) dies with the executor.
- **Parse stored states strictly.** Reading a state string the vocabulary
  does not know is a defect to surface, never a value to coerce — the
  tempting fallback ("unknown means failed") silently converts a
  vocabulary-drift bug into a plausible-looking verdict, destroying the
  one signal that would have exposed the drift.
- **Bound the escape hatch.** "Any state may transition to cancelled or
  failed" is a common and useful rule — it is what lets reapers, sweeps,
  and operators act without enumerating every source state. But *any*
  must exclude the terminal class, or verdicts stop being final: a table
  that lets `completed` move to `failed` lets a slow executor, a re-run
  sweep, or a double-clicked operator verb rewrite history. Write the
  escape hatch as "any **non-terminal** state," and test the terminal
  states' exits are empty.
- **New state → update the table, the door, and the classifier in one
  change.** A state added to the vocabulary but not to the transition table
  is unreachable; added to both but not classified, it is invisible to
  recovery. Make the three updates one reviewable unit.
- **The machine lives with the record, not with the executor.** Any
  component that can outlive the executor (recovery, operator tooling) must
  be able to drive transitions through the same door with the same rules —
  which is only possible if the door is storage-side logic, not a method on
  the running task.
