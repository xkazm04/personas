---
layer: technique
subject: migrations
technique: error-propagation
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Error propagation

Migration runs at boot, unattended, on machines whose owners do not know
they have a database. The error-handling posture that is merely good
practice elsewhere is existential here, because the migration's failure
modes are the only ones in the system that can *silently rewrite the
ledger of what the data is*. One sentence governs everything below: **a
migration that swallows its own error is worse than a crash.**

## Why swallowed beats crashed for worst place

Trace both timelines from the same failing step:

**The crash.** The step fails, the chain halts, the application refuses to
start with a message naming the step. The user is blocked — visibly,
loudly, today — while the pre-migration snapshot is minutes old and the
ledger still points at the last completed step. Every fact needed for
recovery exists and is fresh. This is a bad morning and a good support
case.

**The swallow.** The step fails, something catches the error and discards
it, the chain continues, the ledger advances to the end. Every subsequent
step now runs against a schema missing its predecessor's work — compounding
the divergence — and then the application starts, *writes new user data
into the malformed schema*, and runs for weeks. The failure finally
surfaces as an unrelated query error or silent data loss, long after the
snapshot rotated away, on a store whose version number vouches for a shape
it does not have. No fact needed for recovery still exists.

The swallow is not a softer failure; it is the same failure plus a delay,
minus the snapshot, minus the diagnosis, plus interest. At boot time, with
a fresh snapshot behind you, **crashing is the safe direction** — the one
moment in the application's life when the brutal option is the kind one.

## The boot contract: three spellings, never fewer

A migration runner's boot has exactly three outcomes, and each must be
distinguishable by its output alone
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

1. **Nothing pending** — ledger read, matched the code's version, no work.
2. **Applied** — steps *k+1…n* ran; say which, from what to what.
3. **Failed at step j** — chain halted, ledger stands at *j−1*, snapshot
   at hand.

The classic collapse is 3 masquerading as 1: a runner that cannot *read*
the version — file locked, header damaged, ledger table missing — and
reports "nothing to do". Zero-steps-because-current and
zero-steps-because-blind are different facts; the runner asserts its
instrument (the ledger was readable, the version was plausible) before it
reports a result. The same collapse spelled smaller is the guarded step
that skips instead of asserting — see
[idempotent-steps](idempotent-steps.md) — and spelled larger it is
downgrade tolerance: a version *newer* than the code knows is outcome 3's
cousin, "refused", with its own message naming both versions. It is never
outcome 1.

## What the error must carry

A migration error is read twice — by the user (rarely, briefly) and by
whoever supports them (deeply, later). It carries, structurally: which step
failed; migrating from which version toward which; the operation in flight;
the store's underlying error verbatim; and where the snapshot is. Then it
travels somewhere it can be seen — the log always, the user-facing refusal
message in summary, telemetry when consent allows. An error that only went
to a console nobody attaches to has been propagated in the technical sense
only.

What the runner does *next* is policy, not error handling: halt is
mandatory; auto-restore of the snapshot is legitimate only in the narrow
same-boot window where nothing has been written since it was taken
([pre-migration-snapshots](pre-migration-snapshots.md)); retry-on-next-boot
is the default residual (the ledger makes it correct by construction).
Retry *loops* within one boot are noise — a failing schema step is
deterministic and will fail identically five times.

## No mercy clauses in the chain

Every softening of the halt rule reappears in support queues:

- *"Continue past the failed step; later steps probably don't depend on
  it."* Dependency between steps is invisible at the call site; the chain's
  order is the only dependency declaration that exists. Hopping produces a
  schema no release ever tested, stamped with the version of one that was.
- *"Log the error but mark the step done, so users aren't stuck in a
  retry-fail loop each boot."* This writes a lie into the ledger — the one
  structure whose truthfulness every other technique presumes. A ledger
  advanced past reality cannot be distinguished, ever again, from one that
  is honest; the fork is permanent.
- *"Wrap each step so one bad step can't take down boot."* Resilience
  vocabulary from request-serving does not transfer: a failed request has
  a next request, a failed migration step has no next anything — everything
  after it is built on it.

The test for any proposed leniency: does it leave the ledger stating
something false, or leave the application running on a schema the ledger
does not describe? If either, it is a swallow with better manners, and the
timeline it buys is the second one above. The gate here — boot — is the
last one that actually sees the store before user data flows into it
([gate-sees-target](../../_laws.md#gate-sees-target)); weaken it and no
later gate observes anything.
