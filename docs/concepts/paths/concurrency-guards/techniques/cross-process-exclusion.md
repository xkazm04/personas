---
layer: technique
subject: concurrency-guards
technique: cross-process-exclusion
status: forged
laws:
  - gate-sees-target
  - failure-not-empty-success
shared_with: []
---

# Cross-process exclusion

An in-process guard observes exactly one process. When the duplicate can
originate elsewhere — a second app instance, a background worker beside the
app, two automation sessions on one machine, two nodes behind one database —
the memory set is a gate that cannot see its target (law: gate-sees-target):
it passes precisely in the scenario it was installed for. Crossing the process
boundary is not "the same guard, bigger"; it is different machinery with a
question in-process guards never face at all: **the holder can die without
executing any release path.** Every cross-process design is judged by its
answer to the dead-holder question.

## The substrate options

All variants share one requirement: acquisition must be an atomic
test-and-set on substrate every participant can see. Beyond that they differ
in how they detect a dead holder.

- **Lock artifact with staleness metadata.** A file or record created
  exclusively (the create-if-absent primitive of the substrate does the
  atomicity), carrying holder identity — process id, host, acquisition time.
  A contender finding the artifact checks liveness: is the named holder still
  alive; is the artifact younger than a staleness bound? Stale → take over,
  loudly. The takeover itself must be atomic (replace-if-unchanged), or two
  contenders both "take over" and the guard has reproduced the race one level
  up.
- **Heartbeat lease.** The holder renews a timestamp on a cadence; the lease
  is valid only while fresh. Contenders never ask "does the holder exist"
  (unanswerable across hosts) — only "has it renewed lately," which the
  substrate answers directly. The renewal cadence and expiry bound need
  headroom for pauses (a stalled process that resumes must discover it lost
  the lease *before* acting again — the fencing check belongs at the write
  site, see attempt-attribution).
- **Compare-and-swap claim on shared state.** Where the participants already
  share a transactional store, the guard can be a conditional update: claim
  the row where status is claimable, atomically writing holder and time. The
  scheduling path's claim-based dispatch is this pattern in its natural home;
  the general form works for any "exactly one process should take this item"
  shape.
- **Population check.** Stateless: instead of acquiring anything, a contender
  observes artifacts the *competing activity itself* necessarily produces
  (running processes, working files, open ports) and declines to start while
  the population is nonzero. No release problem exists because nothing is
  acquired — the evidence disappears with the activity. The cost: it is
  advisory (a participant that skips the check is unguarded) and
  race-windowed (two contenders can both observe zero). Right for
  coarse-grained "don't start a second heavy build," wrong for correctness-
  critical exclusion.

## Fail-open or fail-closed — chosen and written down

Every cross-process guard eventually meets an ambiguous state: the artifact
exists but liveness is unknowable; the store is unreachable; the staleness
clock is suspect. The design must pre-decide its direction and document it:

- **Fail-closed** (refuse to proceed): right when duplication corrupts —
  double-spends, double-writes to an external system, conflicting migrations.
  The cost is availability: a wedged guard halts the operation until a human
  or a staleness bound clears it.
- **Fail-open, loudly** (proceed, with a visible warning): right when the
  guarded work is idempotent-ish or merely wasteful when doubled, and
  halting it costs more than duplicating it. "Loudly" is load-bearing (law:
  failure-not-empty-success) — fail-open with a silent shrug is
  indistinguishable from no guard, and the day the warning would have
  explained a corruption, there is nothing in the record.

The direction is per-operation, derived from what a duplicate actually costs —
never a property of the lock library.

## Clocks lie, holders pause

Two humility rules for anything staleness-based. First, timestamps compared
across hosts inherit clock skew; staleness bounds must be generous relative
to plausible skew, or a fast clock steals a live holder's lock. Second, a
paused holder (debugger, swap storm, runtime pause) can outlive its lease and
resume believing it still holds it; if the guarded effect is a write to shared
state, the write itself must re-verify tenure (a fencing token — the lease
generation carried into the write and checked there), because the guard alone
cannot reach into the future where the pause ends.

## Decision rules

- Name the duplicate's origin first: if any second process can produce it, an
  in-process guard is scenery, whatever else it does.
- Acquisition is atomic test-and-set on shared substrate; takeover is atomic
  replace-if-unchanged. Any check-then-act gap is the race, relocated.
- Every artifact carries holder identity and time; every design answers the
  dead-holder question with a staleness bound derived from real durations and
  real skew.
- Choose fail-open-loudly or fail-closed per operation, from the cost of a
  duplicate; write the direction down where the next reader will look.
- Population checks are for advisory, coarse exclusion of expensive work —
  never the sole wall for correctness.
- Where a paused holder could resume into a lost lease, carry a fencing token
  into the effect and verify it at the write site.
