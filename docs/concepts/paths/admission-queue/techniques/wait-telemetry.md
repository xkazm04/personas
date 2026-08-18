---
layer: technique
subject: admission-queue
technique: wait-telemetry
status: forged
laws: [count-carries-predicate, gate-sees-target]
shared_with: []
---

# Wait telemetry

A queue that does not measure waiting hides the one number that explains
the user's experience. The request's owner sees a single duration —
"I asked at T, I got an answer at T+42s" — but that duration is a **sum of
two numbers with different owners**: time spent waiting for admission
(the queue's) and time spent executing (the executor's). Telemetry that
reports only the sum guarantees the wrong component gets optimized.

## The split: wait time is its own measurement

The queue stamps three instants on every entry: **arrived** (verdict
requested), **promoted** (execution began), and where relevant **exited
otherwise** (cancelled, shed, revoked). Wait time is promoted − arrived,
recorded as a first-class measurement, attached to the run so it travels
wherever the run's record travels, and reported *separately* from
execution time — never pre-summed.

The failure this prevents has a recognizable face: a fast executor behind
a slow queue **reads as a slow executor**. Users report "runs take a
minute"; the executor's own numbers say twelve seconds; without the split,
the team profiles the executor, ships an optimization, and the minute
persists — because forty-eight seconds of it was queue wait, invisible in
every place anyone looked. The split makes the same incident a one-lookup
diagnosis: wait 48, execute 12, fix the admission side (capacity, caps,
a closed pressure gate) instead of the execution side.

One trap deserves its own sentence: **a wait number computed but never
exported is telemetry that does not exist.** A queue that stamps the wait,
logs it once at promotion, asserts it in a test, and hands it to no
persistent record and no consumer-facing event has done all the work of
measurement and none of the work of telemetry — the number must land where
diagnosis happens (the run's durable record, the status surface, the
metrics stream), or the fast-executor-slandered incident proceeds exactly
as if the wait had never been measured.

The split also *composes*: what the executor calls "execution" often
contains further waits (a slot inside the runner, a rate window at a
provider). Each waiting layer owns its own stamp pair; the discipline
recurses, and end-to-end latency becomes a sum of named segments instead
of one unattributable blob.

## Depth, with its predicate

Depth is the queue's most-quoted and most-misquoted number. "Depth 30"
is not a fact until it carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
waiting entries, waiting-plus-promoting, or everything-not-finished are
three different counts, and they diverge exactly when the system is under
the load that made someone ask. The queue reports:

- **depth by state** — waiting, promoting, running counted separately;
- **depth by class and by origin** — because a healthy aggregate can
  conceal one starving class or one origin holding every position (the
  fairness pathology is only visible in the decomposition);
- **depth against bound** — 47 alone alarms nobody; 47-of-50 is a fact
  with a consequence attached.

And the counters must observe the real population
([gate-sees-target](../../_laws.md#gate-sees-target)): a depth gauge
maintained as an increment/decrement ledger drifts from the actual entry
set whenever an exit path forgets its decrement — after which every
number in this technique quietly lies. Either derive counts from the
entry set itself, or reconcile the ledger against it on a cadence.

## Oldest-wait: the starvation instrument

Averages forgive; maxima accuse. Mean wait stays flat while one entry
ages forever — starvation is invisible in every average by construction.
The instrument that sees it is **oldest current wait, per class and per
origin**: the age of the longest-waiting entry now in the queue. Growth
without bound in any slice is the definition of starvation, whatever the
scheduling policy claims about itself. This is the number
[priority-and-fairness](priority-and-fairness.md) is verified against —
a fairness policy without this gauge is a fairness *intention*.

## Wait objectives

A wait measurement earns its keep when a target stands next to it: each
class declares a wait objective (interactive: seconds; bulk: hours) drawn
from the same tolerance analysis that sized the depth bound in
[depth-bounds-and-shed](depth-bounds-and-shed.md). The objective turns
telemetry into decisions three ways:

- **Alerting** — sustained objective violation pages capacity, not the
  executor team;
- **Honest promises** — position and expected wait shown to the waiting
  caller come from measured service rate, not optimism; a queue that can
  compute "position 4, typically ~2 minutes" converts an anxious poll
  into a calm wait, and a queue that cannot should show position alone
  rather than invent a number;
- **Shed pressure** — when measured wait at the tail exceeds the class
  objective, the depth bound is too deep: entries are being promised
  what the numbers prove cannot be delivered.

## Verdict counters close the loop

Alongside the durations, count the verdicts: admissions, queue-fulls,
over-quotas, pressure refusals, sheds, cancellations — each by reason,
over time. The refusal-rate trend is the earliest capacity-planning
signal the system produces (it moves before wait times do, because the
bound clips the queue *before* waits explode), and a shed counter that
jumps is an incident announcing itself. The vocabulary technique makes
these countable; this technique insists they are counted.
