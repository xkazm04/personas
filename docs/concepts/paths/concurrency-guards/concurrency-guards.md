---
layer: golden-path
subject: concurrency-guards
status: forged
techniques:
  - guard-key-design
  - single-flight-primitives
  - release-guarantees
  - cross-process-exclusion
  - attempt-attribution
  - idempotency-by-design
evidence:
  - src-tauri/engine/src/inflight_guard.rs                     # the reusable keyed in-flight set: atomic acquire, RAII handle, panic-unwind release proven by test, poison recovery — adopted by 14 statics
  - src-tauri/src/lib.rs                                       # ActiveProcessRegistry::try_begin — atomic claim per flow-kind domain, clear_id_if verified release, begin_run supersede-with-fresh-token
  - src-tauri/src/commands/credentials/ai_artifact_flow.rs     # panic-safe wrapper (catch_unwind → clear_id_if + failure event); incumbency check get_id != task_id before applying results
  - src-tauri/src/engine/leadership.rs                         # cross-process heartbeat lease (engine-leader.lock): stale takeover, follower re-attempt per tick
  - scripts/build/guard-concurrent-cargo.mjs                   # stateless population check over live processes; fail-open LOUDLY, direction documented in the header
  - src/lib/utils/deduplicateFetch.ts                          # join-the-result single-flight keyed by args; release bound to promise settle via finally
  - src-tauri/engine/src/oauth_refresh_lock.rs                 # per-entity queue-behind policy (await the twin) where both refreshes must eventually run exactly once each
counter_evidence: []
deviations:
  - w9-concurrency-guards   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Idempotency & in-flight guards

Any operation reachable from more than one place will eventually be reached from
two places at once. A user double-clicks; a scheduler tick overlaps its
predecessor; two views mount and each fetch the same resource; a retry fires
while the original attempt is still alive; two processes both decide the same
maintenance is due. The subject of this path is the discipline that keeps **one
logical operation from running twice concurrently** — and, when a second run
does happen anyway, keeps its late result from corrupting the first's.

Several sibling paths own specialized rooms in this house:
[scheduling](../scheduling/scheduling.md) owns overlap policy for scheduled work
([overlap-and-reentrancy](../scheduling/techniques/overlap-and-reentrancy.md));
[background jobs](../background-jobs/background-jobs.md) owns loop tick
re-entrancy ([tick-isolation](../background-jobs/techniques/tick-isolation.md));
[client state](../client-state/client-state.md) owns UI-side async races
([async-race-guards](../client-state/techniques/async-race-guards.md));
[concurrent version control](../concurrent-vcs/concurrent-vcs.md) owns
multi-process collisions over shared working files. This path owns what all of
them specialize: the **general single-flight and idempotency discipline** — how
duplicate work is defined, refused, released, and survived.

The failure modes are worth naming precisely, because they pull in opposite
directions. **Doubled work** wastes resources at best and corrupts state at
worst: two credential refreshes each invalidating the other's token, two version
writers both claiming the next sequence number, two identical requests billed
twice. **Stuck work** is the guard's own failure mode: an in-flight entry that
was acquired and never released blocks that key forever, and the system
degrades from "occasionally does things twice" to "can never do this thing
again." A guard that trades the first failure for the second has made things
worse — duplication is usually recoverable, a wedged key usually is not.

## The core stance: the guard key is the design

Every duplicate-prevention mechanism reduces to a set membership test: *is an
operation with this identity already running?* Everything else — mutexes,
registries, lock rows, dedup caches — is implementation. The design decision,
the one that cannot be delegated to a library, is **what identity means**: which
axes (entity, operation kind, arguments, initiator) make two invocations "the
same operation," decided explicitly and written down.

> **Two operations are duplicates because the design says so, not because their
> code paths happen to collide. Choose the key on purpose.**

Get the key wrong in either direction and the guard misbehaves invisibly. Too
broad — one key for "any refresh" — and unrelated work serializes behind it,
which reads as mysterious slowness, never as a guard bug. Too narrow — the key
includes a timestamp or a request id — and every invocation is unique by
construction, the set never has a hit, and the guard is decorative. Both
failures pass every test that doesn't specifically probe key granularity (see
guard-key-design).

From that stance, the spine of the subject:

1. **One reusable primitive beats N bespoke mutexes.** When every call site
   invents its own boolean flag or lock, each invents its own acquire/release
   semantics and each gets the edge cases independently wrong. A single
   in-flight key set with one acquire door and one release door concentrates
   the correctness burden in one place, and makes "what is currently guarded?"
   an answerable question (see single-flight-primitives; law:
   one-validation-door in its guard form — enumerate the acquirers).
2. **Release is guaranteed, or the guard becomes the outage.** Every
   acquisition names its release path — including the panic path, the timeout
   path, and the early-return path. A guard held in a plain variable and
   released by a line of code at the end of the happy path is a leak with a
   delay fuse (see release-guarantees; law: creation-names-reaper).
3. **The second caller's experience is a designed outcome.** Refuse loudly,
   join the in-flight result, queue behind it, or coalesce into it — all four
   are legitimate, but the choice is per-operation policy, and a refusal must
   be distinguishable from a failure of the operation itself (law:
   failure-not-empty-success).
4. **Cross-process exclusion is different machinery, not a bigger memory set.**
   An in-process set stops nothing running in another process. Crossing the
   boundary requires shared substrate — a lock with staleness handling, a
   compare-and-swap claim on a shared row, or a population check over
   observable artifacts — and every such mechanism must answer the question
   in-process guards never face: *what happens when the holder dies without
   releasing?* (see cross-process-exclusion).
5. **The guard prevents concurrent starts; attribution survives concurrent
   finishes.** Guards are gates at the entrance. When an old attempt was
   superseded — cancelled, timed out, replaced — its result may still arrive,
   and only an attempt identity carried from start to write-site lets the
   system discard the stale writer instead of letting last-to-finish win (see
   attempt-attribution).
6. **Idempotency is the complement, not the fallback.** Where an operation can
   be made safe to run twice — conditional writes, natural keys, dedup at the
   effect — the duplicate becomes harmless instead of prevented, which is
   strictly more robust: it also covers the duplicates no guard can see, like
   the retry of a request whose response was lost (see idempotency-by-design).

## Belt and suspenders: guards and idempotency compose

The mature posture is not "guard everything" or "make everything idempotent" —
it is knowing which layer is load-bearing for which operation. A guard is the
right primary defense when the operation is expensive or has visible side
effects mid-flight (the second caller should not even start). Idempotency is
the right primary defense when duplicates can arrive through channels no guard
observes (retries after lost responses, replayed messages, restarted
consumers). Critical operations deserve both: the guard makes duplicates rare;
idempotency makes the rare survivor harmless. What is never acceptable is the
implicit third option — an operation that is neither guarded nor idempotent,
protected only by the assumption that concurrent invocation "shouldn't happen."
Reachability from two places is not a bug; it is a property of systems with
users, schedulers, and retries.

## What "done" looks like for this subject

A codebase meets the bar when: every operation that must not run concurrently
with itself is guarded by an explicit key whose axes someone chose and can
defend; guards go through a shared primitive with one acquire and one release
door, so the set of guarded operations is enumerable; every acquisition's
release is structurally guaranteed against panic, timeout, and early return —
a leaked entry is a bug class the design has eliminated, not a runbook entry;
operations shared across processes use cross-process machinery with an explicit
stale-holder story, and its failure direction (open or closed) is documented;
results carry the identity of the attempt that produced them, and the write
site discards stale writers instead of trusting arrival order; and the
operations where duplication is cheapest to survive are simply idempotent, so
the guard is an optimization rather than the only wall.
