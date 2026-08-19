---
layer: technique
subject: data-access
technique: transactions-and-units-of-work
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Transactions and units of work

A transaction is the mechanism by which several statements become one fact:
all of them happened, or none did. The technique is not about knowing that —
everyone knows that — it is about three questions that scattered codebases
answer by accident: *who opens the boundary*, *how operations compose inside
it*, and *what is allowed to happen within it*.

## The boundary belongs to the invariant

A transaction exists to protect a multi-write invariant: create the parent
and its first child together; decrement here exactly when incrementing
there; delete the record and its attachments as one act. The rule that
answers "who opens the transaction" is: **the code that knows the invariant
owns the boundary.**

- When the invariant is *internal to one repository operation* — an upsert
  that must read-then-write, a delete that must cascade within one
  aggregate — the repository function opens, commits, and the caller never
  knows. The invariant is the layer's business; so is its boundary.
- When the invariant *spans repository operations* — an application action
  that must atomically touch two aggregates — the boundary moves up to the
  application code that knows why the writes belong together. This is the
  unit of work: the caller opens a scope, calls several repository
  operations inside it, and commits once.

What the rule forbids is the middle mush: repository functions that
sometimes commit and sometimes don't depending on an implicit flag, or
application code opening transactions around single operations "for
safety" (a single statement is already atomic; the wrapper adds lock
lifetime and nothing else).

## Composability: operations must not care

For the unit of work to exist, every repository operation must run correctly
in both worlds — standalone, and inside a caller's open transaction. The
classic defect is the operation that unconditionally opens its own
transaction: called inside a unit of work it either fails (engines that
refuse nesting), silently escapes the outer boundary (implicit
auto-commit), or commits the outer work early — all three corrupt the
caller's invariant, and two of the three do it *silently*.

The structural fixes, in order of preference:

1. **Pass the scope explicitly.** Operations take a handle that is either a
   plain connection or an open transaction, and simply execute against it.
   The type system carries the context; nesting is impossible to get wrong
   because the operation never opens anything.
2. **Nest via savepoints** where the engine supports them and the layer
   wants to offer partial rollback: the operation opens a savepoint when a
   transaction is already ambient, a real transaction otherwise. More
   machinery; only worth it when inner-operation rollback with outer
   continuation is a real requirement.

What does not work: detecting ambient state by side channel and silently
skipping the begin — unless the *commit* is skipped symmetrically and
failure semantics are re-examined, this converts "my operation is atomic"
into "my operation is atomic sometimes", the worst kind of true statement.

## Errors inside the boundary must reach it

The transaction's promise is only as good as its error path. The defect
class that voids it: a step inside the boundary fails, the failure is caught
and logged (or worse, swallowed) by helpful intermediate code, control
reaches the commit, and the store durably records a state the invariant
forbids — with a success result in the log. This is empty success at its
most expensive
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
half a unit of work, committed, is strictly worse than the whole unit
failing, because nothing will ever look for the missing half.

The rules: inside a unit of work, **every error propagates to the boundary
owner**; catch-and-continue is legal only for steps whose failure the
invariant genuinely tolerates, and that tolerance is written at the catch
site. And the rollback path is *the* path on any error — including the
ones that "can't happen" — which is why scope-based designs where the
rollback runs automatically on abnormal exit beat designs that rely on a
hand-written rollback call in every error branch.

## Side effects wait for commit

A transaction can roll back; most of the world cannot. Anything
irreversible or externally visible performed *inside* the boundary becomes
a lie the moment the transaction aborts: the notification announcing a
record that does not exist, the cache primed with rolled-back state, the
downstream system told to proceed. The rule: **inside the boundary, only
the store changes.** Effects queue — as values, in memory, or in an outbox
table that commits atomically with the data it announces — and fire after
commit returns. The outbox form is the strong version: the effect's
*intent* is durable exactly when the data is, and a crash between commit
and delivery loses nothing.

The mirror rule is quieter but real: **do not hold the boundary open across
slow outside work.** A network call inside a transaction holds locks for
the call's full latency; on engines with a single writer, that is the whole
application's write throughput held hostage to a third party's response
time. Read what you need, close, do the slow thing, then open a fresh
boundary to record the outcome — and revalidate the read if the invariant
depends on it (the state may have moved while you were away).

## Keep boundaries short and finite

Lock lifetime is the currency transactions spend. The habits that keep the
spend small: open the boundary as late as possible (after parsing, after
validation, after anything that can fail cheaply); touch tables in a
consistent order across the codebase so two units of work cannot deadlock
by acquiring in opposite orders; and never put an unbounded loop inside a
boundary — a unit of work that grows with the data (migrating a million
rows, reconciling an arbitrary backlog) is a *batch job* wearing a
transaction's clothes, and it needs the batch discipline (bounded chunks,
each its own transaction, a resumable watermark) rather than one heroic
boundary that holds the store for a minute and dies at row 900,000.

## Read-modify-write is a transaction, not a habit

The subtlest boundary omission: read a value, compute, write it back — as
two independent operations. Two concurrent actors both read the old value
and the last writer erases the first's contribution; no error is raised
anywhere. Any read whose *result feeds a write* belongs inside the same
boundary as that write, with the isolation level (or an explicit
compare-and-set predicate on the write) chosen to make the race lose
loudly instead of silently. The grep-shaped review question: every write
whose value came from an earlier read — where is the boundary that spans
both?

## The single conditional write beats the transaction it replaces

Before reaching for a boundary at all, ask whether the invariant fits in
*one statement*. Engines are very good at making one statement atomic, and
two shapes cover a surprising share of real invariants:

- **The compare-and-set update**: `update … where <the state I read>` —
  the predicate carries the precondition, and "zero rows affected" *is*
  the answer "someone else won". Claiming a job, advancing a state
  machine, expiring a lease: all are this shape, need no explicit
  transaction, and are strictly better than the read-check-write spelling
  of the same intent.
- **The conflict-target insert**: insert-or-update (or
  insert-or-do-nothing) with the conflict target named, replacing the
  check-then-insert pair whose race window produces either duplicates or
  spurious uniqueness errors depending on who loses.

Both come with one iron obligation: **the verdict is part of the write.**
The rows-affected count of a conditional write is the outcome of the race,
and code that executes the statement and ignores the count has protected
the data while corrupting the story — it proceeds down the "I won" path
after losing, firing consequences (notifications, state transitions,
user-visible reports) for a change that did not happen. A conditional
write whose result is discarded is worse than reviewable: it *looks*
concurrency-safe.
