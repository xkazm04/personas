---
layer: technique
subject: subprocess-lifecycle
technique: termination-and-reaping
status: forged
laws: [creation-names-reaper, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Termination and reaping

A child process ends in exactly one of a small number of ways, and the host
must have designed **all of them** — including the ones where the host
itself is the thing that ended. This technique owns the stop ladder, the
races around it, the collection of the corpse, and the honesty of the
record. Its organizing law is literal here:
[everything created names its reaper](../../_laws.md#creation-names-reaper),
and for a process the reaper is code with an address, not a hope.

## The termination ladder

Stopping a child is an escalation with deadlines, not a single act:

1. **Polite stop.** The platform's cooperative stop request (or the tool's
   own stop protocol — closing its input, a control message). This is the
   rung that lets the child flush, release locks, and write its own
   shutdown record.
2. **Deadline.** A bounded grace period. The deadline is a design constant
   chosen per tool class — long enough for an honest flush, short enough
   that a wedged child cannot hold a slot hostage.
3. **Forcible kill.** Unconditional, unrefusable termination — applied to
   the **whole tree** (below), not just the root.
4. **Verify and record.** Confirm the exit was collected, and record *which
   rung was needed* — a population of children that routinely requires rung
   3 is a defect report about the children, visible only if the ladder
   keeps score.

The ladder runs identically regardless of *why* termination was requested —
user cancellation, ceiling exceeded, host shutdown, stall escalation. One
ladder, many callers; the reasons differ in the recorded outcome, never in
the mechanics.

## Cancellation races completion

The normal awaiting posture is a **race**: the host waits on
child-exited *and* cancel-requested simultaneously, and either can win.

- If exit wins, cancellation later must be a no-op — idempotent, not an
  error, because the requester cannot know it lost the race.
- If cancel wins, the ladder runs, and the eventual exit is still collected
  — losing the race does not excuse the reap.
- If the awaiting code itself is torn down — error path, early return, task
  aborted — the **kill-on-drop backstop** fires: the child handle is
  configured *at spawn* so that dropping it kills the process. Kill-on-drop
  is insurance, not the mechanism: it skips the polite rung and writes no
  outcome, so any path that relies on it as the *primary* stop has already
  lost the record. Its job is to convert "leaked a live process" into
  "skipped a graceful shutdown" on the paths nobody designed.

## Kill the tree, not the pid

Real tools spawn helpers; interpreters spawn workers; wrappers spawn the
actual program. Terminating only the direct child detaches its descendants —
which keep running, keep the ports and locks, and now belong to nobody.
Termination therefore targets the **process tree**: a platform grouping
mechanism established at spawn (a group, a job object, a session) so the
kill addresses the family atomically, or an explicit descendant walk where
no grouping exists. The walk variant races against the tree changing under
it — children spawning grandchildren mid-kill — which is why establishing
the group *at spawn* is the door's job, not the killer's improvisation.

## Reaping is unconditional

Every spawned child is eventually **waited on** and its exit status
collected. An unreaped child is a platform resource leak (a zombie entry, a
held handle) — and, worse, a bookkeeping lie: the host's slot accounting,
liveness roster, and scratch-space cleanup are all keyed to the reap. The
reap is the single point that releases what the spawn acquired; a path that
kills without reaping shrinks the host's effective capacity by one, forever,
silently. Audit rule: every code path that can learn the child is gone —
normal exit, ladder kill, kill-on-drop — must converge on the same
release sequence, exactly once (the reap is idempotent or guarded, because
two paths *will* eventually both fire).

## Exit honesty

"The process ended" is not an outcome; it is a fact awaiting
classification. The closed vocabulary distinguishes at minimum:

- **completed** — exited zero, and where the tool has a richer protocol,
  its own success record agrees (an exit code of zero from a crashed
  wrapper is the classic false green);
- **failed** — exited nonzero, code preserved verbatim;
- **killed** — died by signal/forcible termination, and *whose*: the
  host's ladder (with the originating reason — ceiling, cancel, shutdown)
  versus the platform or an outside agent;
- **spawn-failed** — never existed; must not be dressed as an exit;
- **lost** — the host cannot know (crash gap), resolved by the sweep.

Collapsing these into a boolean is
[failure spelled as empty success](../../_laws.md#failure-not-empty-success)
in its process form — most commonly as "no exception thrown while waiting,
so it must have worked".

## Orphans: when the host dies first

A host crash orphans every live child. The children cannot be asked to
handle this; the *next* host incarnation must. The mechanism is the
**startup orphan sweep**:

- **Mark at spawn.** The door stamps every child with a durable identity
  marker — an environment tag, a marker file in the run's scratch
  directory, a registry row — that names the owning host instance and run.
- **Sweep at start.** Each host start enumerates candidate survivors by
  marker, not by name: "a process with the tool's name" is somebody else's
  legitimate work; "a process carrying my instance marker from a dead
  incarnation" is an orphan.
- **Verify before killing.** Process ids are recycled by the platform;
  between the record and the kill, the id may name an innocent stranger.
  The sweep re-verifies identity (marker still present, start time
  matches) immediately before acting —
  [identity survives reuse](../../_laws.md#identity-survives-reuse), applied
  to the platform's own id space.
- **Resolve the record.** Every swept orphan's run record is settled as
  *lost-to-host-crash* — the sweep is also the bookkeeping repair, not just
  the killing.

The sweep is a recurring obligation, not only a boot step: a periodic pass
catches orphans created by crashes of *other* cooperating host instances.
Where the host already has a supervised recurring-loop runtime, the sweep
runs as one of its loops
([background-jobs](../../background-jobs/background-jobs.md) owns that
machinery).
