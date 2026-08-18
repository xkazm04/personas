---
layer: technique
subject: structured-output
technique: op-grammar-allowlisting
status: forged
laws: [one-authority-per-vocabulary, one-validation-door]
shared_with: []
---

# Op-grammar allowlisting

The most consequential artifact a model can emit is a **list of operations**
— proposals for what the system should do. This technique is the mechanical
form of a single sentence: **the model proposes from a closed vocabulary;
everything else is data, not action.** It is where the abstract trust
boundary (model output is untrusted input — the prompt-safety subject owns
that framing) becomes enforcement you can point at in a code review.

## The grammar is closed and singly defined

An op-grammar is a set of operation names, each with a typed argument
schema. Three renderings of it necessarily exist — the **prompt menu** the
model chooses from, the **validator** that checks proposals, and the
**dispatcher** that maps names to handlers — and all three derive from one
authoritative definition
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The drift failure is asymmetric and both directions are real: an op in the
prompt but not the dispatcher yields proposals that silently do nothing
(the model looks broken); an op in the dispatcher but not the prompt is a
live capability reachable only by a model that guesses — or is induced to
guess — its name. The second is a security hole shaped exactly like the
first's mirror image, which is why "the lists match" is a checkable
invariant, not a convention.

## One dispatch door

All execution flows through a single dispatch point that looks up the
operation name in the allowlist and hands the typed arguments to the
handler. The anti-pattern it exists to kill: call sites scattered through
the codebase that read an op name out of model output and `match` on it
locally. Each scattered site is a private grammar with private validation —
which is to say, a second validation door
([one-validation-door](../../_laws.md#one-validation-door)) that will not
be updated when the grammar changes. The dispatcher is also the natural
home of the cross-cutting concerns no handler should re-implement:
per-op authorization, rate limits, audit logging, and the approval gate
for consequential ops.

## The unknown-op policy

A proposal naming an operation outside the vocabulary is not an error to
throw, and above all not something to "try anyway":

1. **It is never executed.** There is no reflective fallback, no
   "look up a function by this name" path, no forwarding to a shell or
   interpreter. The execution path for unknown ops does not exist —
   *cannot* exist, structurally, not merely "is not called".
2. **It is counted and sampled.** Unknown-op frequency is a first-order
   drift signal: the prompt menu and the model's beliefs have diverged, or
   the model is confabulating capability, or something upstream is injecting
   proposals. Each of those has a different fix and the samples tell you
   which.
3. **It may be displayed.** Rendering the proposal inertly ("the assistant
   suggested an unavailable action") is a legitimate product choice;
   the display channel is welcome to it — as data.

## Arguments are validated before acting, per op

An allowlisted name with unvalidated arguments is half a gate. Each
operation's argument schema is enforced at dispatch — types, ranges,
vocabularies — and, critically, **references are resolved and scoped**
before the handler runs:

- the id exists;
- it names an entity of the kind this op operates on;
- it is within the scope the *session or caller* is authorized for — the
  model's proposal inherits the caller's authority and can never exceed it.
  An op that acts on "whatever id the model wrote" performs the confused-
  deputy manoeuvre with extra steps.

Scope checks belong to the dispatch door, not the handlers, because a check
that N handlers must each remember is a check that N−1 will eventually
perform and one will not.

## Idempotency and replay

Model-proposed op lists get retried: the turn is regenerated, the repair
loop re-emits, the user clicks twice, a resumed session replays a tail.
Design for it: ops that create carry a client-generated identity so the
second application is a no-op rather than a duplicate; ops that mutate state
to an absolute value are naturally replay-safe; ops that apply *relative*
change (increment, append, toggle) are the dangerous class and either carry
a dedup key or are redesigned as absolute. A proposal list is data until
dispatched — dispatch is the moment idempotency matters, and it is one
door, so the dedup ledger has one home.

## Failure within a list

A proposal list is not a transaction by default, and pretending otherwise
breeds worse behavior than honesty. State the policy per flow — first
failure stops the list, or failures are collected while independent ops
proceed — and report per-op outcomes either way. What is never acceptable
is the silent middle: three of five ops applied, no record of which, and a
user looking at state that matches neither before nor after. Where the ops
are genuinely interdependent, stage them all, validate the set, and apply
atomically — at which point the list is one compound operation and belongs
in the grammar as such.
