---
layer: technique
subject: migrations
technique: idempotent-steps
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Idempotent steps

Two disciplines exist for making a migration chain safe to run on a machine
whose history you do not know, and the first decision is understanding that
they answer *different threats*, so mature systems use both.

## Discipline 1: the run-once ledger

The store records the highest step it has completed; the runner executes only
steps above that mark, in order, advancing the mark as it goes. This is the
primary mechanism — it is what makes "any machine, any starting version" a
bounded problem — and its correctness rests on exactly one invariant: **the
step's effects and the ledger advance commit atomically, together**. If the
step applies but the crash eats the ledger bump, the next boot re-runs a step
against a schema that already absorbed it; if the bump lands but the step's
effects are lost, the chain skips real work forever. Everything else about
run-once is bookkeeping; this invariant is the design.

## Discipline 2: replayable steps

Each step is written so that running it twice leaves the same result as
running it once. Additive changes get existence guards ("create unless
present", "add unless present"); destructive ones check before acting. Where
the engine's verbs have no conditional form, the step inspects the live
schema and decides.

Replayability is **defense in depth for the crash window** the ledger cannot
fully close on engines with non-atomic schema verbs — and that is the whole
of its mandate. It is not a substitute for the ledger: a chain that relies on
guards *instead of* a ledger re-executes every step on every boot, turning
every guard into load-bearing logic and every boot into a re-migration.

## The hazard that makes guards dangerous

**A guard that skips is indistinguishable from a guard that succeeded.** Both
return cleanly; both advance the ledger; both log nothing. That symmetry is
exactly the shape of the most expensive lie in automation — empty success
wearing the uniform of success ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

The canonical disaster: a step patches a table with a guarded additive
change. On stores that upgraded through history, the table exists and the
patch lands. On stores built fresh — where creation happens elsewhere in the
sequence, later than this step's author assumed — the guard finds no table
and *skips*. No error. The version advances. From that day the fleet is
forked: two schema populations, one version number, and the missing piece
surfaces weeks later as a failure in a query that has nothing to do with
migration. The root cause is invisible precisely because the guard treated
"my precondition is absent" as permission to do nothing.

## Guards assert; they do not tolerate the unknown

The repair is a rule about what a guard is allowed to conclude:

- A guard may recognize **the expected prior state** (the thing I add is
  absent → add it).
- A guard may recognize **the expected completed state** (the thing I add is
  already present *with the shape I would have given it* → pass; this is the
  legitimate replay case).
- **Every other state halts the step with an error naming what was found.**
  A missing table, a same-named column of a different type, a half-applied
  ancestor — these are not replay; they are evidence the chain's guarantee
  broke upstream, and the only safe move is to stop while the snapshot is
  fresh and the ledger still points at the truth.

Skipping is a decision to fork the fleet. Halting is a decision to file a
support case. Only one of those is recoverable.

One refinement for the probe itself: **when a guard cannot determine the
state — the probe errors, the answer is ambiguous — it resolves toward
running the step, never toward skipping it.** A step that runs against the
wrong state fails loudly and halts the chain with the truth in hand; a step
that skips on a broken probe forks the fleet silently. The same uncertainty,
routed to the loud branch instead of the quiet one. A probe wired the other
way — "couldn't check, assume done" — is the entire hazard rebuilt in one
expression.

## Idempotent steps do not make a convergent chain

Chain-level correctness is a property no per-step discipline delivers.
Under replay (and every ledger-less design replays), the chain must be
**globally convergent**: one fixed point, reached once, after which every
run does nothing. Each step being individually idempotent does not imply
this — it is a relationship *between* steps.

The concrete failure: an additive step early in the chain ("add this column
unless present") and a destructive step later ("drop this column, it is
retired"). Each is perfectly guarded, perfectly replayable, and each undoes
the other's post-condition. Under replay the pair oscillates forever — every
boot re-adds and re-drops, paying full table rewrites each time — and no
per-step instrument can see it, because every individual step reports
honest success. The chain has no fixed point, and nothing checks for one.

The repairs, in order of strength: delete the additive step once the
destructive one ships (under replay, history does not need to be preserved
— only the fixed point does); make the destructive step's guard a
post-condition probe so it short-circuits once the state is reached; and
test convergence globally — run the full chain twice against the same
store and assert the second pass performs zero work. That last check is the
chain's own post-condition, and it is the only instrument that sees
relationships between steps hundreds of lines apart.

## Price the fixed point

In a replay design, "done migrating" is not free: a fully-converged store
still evaluates every guard on every boot, and that cost only ever grows —
every step ever shipped adds its probe to every future startup, forever.
Cost each step against the *converged* store, not the migrating one: the
acceptable steady-state answer is one cheap probe that short-circuits.
Anything heavier — an unconditional data scan, a drop-and-recreate "for
safety", a guard that re-reads a large table — is a permanent tax invisible
in every test that only runs the chain once.

## Post-conditions: the cheap universal counterweight

Every step ends by asserting its own post-condition against the live schema:
the column is present with the intended type, the index exists, the row
count of a rewrite matches its input. This converts the entire silent-no-op
class — skipping guards, engines that quietly ignore an unsupported clause,
a conditional verb that matched nothing — into a loud failure *inside the
step that caused it*, at the only moment the failure is cheap.

This is the gate-must-see-its-target rule applied to migrations
([gate-sees-target](../../_laws.md#gate-sees-target)): the ledger observes
that a step *ran*; only a post-condition observes what the step was *for*.
A runner that trusts its ledger alone is gating on a proxy, and the
fleet-fork failure above is the exact moment the proxy diverges from the
target.

## Choosing, in practice

- **Ledger always.** It is the identity of the chain.
- **Atomic step+bump wherever the engine permits** — then replayability
  within a step is nearly free to add and rarely exercised.
- **Replayable phrasing for every step where it costs nothing** (additive
  changes with conditional verbs), under the assert-don't-skip rule.
- **For steps that cannot be made replayable** (destructive rewrites,
  irreversible transforms), do not fake it with guards — make the atomic
  unit airtight and lean on the pre-migration snapshot as the recovery
  story.
- **Never let a guard's skip path be silent.** If a step legitimately
  passes because its work is already done, it says so, and it verifies the
  existing state matches its intent before saying it.
