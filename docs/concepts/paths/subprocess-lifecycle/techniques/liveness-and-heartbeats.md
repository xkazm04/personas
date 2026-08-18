---
layer: technique
subject: subprocess-lifecycle
technique: liveness-and-heartbeats
status: forged
laws: [identity-survives-reuse, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Liveness and heartbeats

"The process exists" is the weakest fact a host can know about a child. A
child can exist and be deadlocked, exist and be waiting on input that will
never come, exist and be looping without progress — all while holding a
slot, a session, and the user's patience. This technique owns the
instruments that distinguish **alive-and-working** from **alive-and-stuck**
from **slow-but-honest**, and the escalation that follows.

## Activity is keyed by run identity

The unit of liveness is **the run**, not the process and not the host. The
instrument is an activity record per run identity — *this* run produced
observable work at time T — updated on every genuine signal and read by
whoever needs to claim the run is progressing.

Two wrong keys, both common:

- **The process id.** Ids are platform-recycled and session-reused; a
  liveness table keyed by pid inherits both aliasing problems. The run
  identity is minted at admission and never reused
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)); the
  pid is an attribute of the run, not its name.
- **A global activity light.** One shared "children are active" signal is
  kept green by any chatty sibling while a specific run has been silent
  for an hour. Aggregates cannot answer the only question that matters —
  *which* run stalled — so the aggregate is derived from per-run records,
  never maintained instead of them.

## What counts as a heartbeat

The activity signal must be evidence of **progress**, observed as close to
the child's real work as possible
([gate-sees-target](../../_laws.md#gate-sees-target)). In descending order
of honesty:

1. **Output events** — the child emitted structured output, a log line, a
   protocol frame. The natural signal for talkative tools, and it is
   usually already flowing through the stream machinery
   ([streaming-output](../../streaming-output/streaming-output.md) owns
   that pipe; this technique only taps its event times).
2. **Artifact effects** — files growing in the run's scratch directory,
   checkpoints appearing. Honest for quiet tools that work on disk.
3. **Consumption metrics** — processor time still accruing to the tree.
   Weak alone (a spin loop accrues forever), but a useful discriminator:
   silent *and* zero-consuming means blocked; silent and burning means
   looping or genuinely computing.
4. **Self-reported pulses** — the child says "still here" on a side
   channel. Weakest, because it measures the heartbeat thread, not the
   work: a tool whose worker is deadlocked while its pulse timer runs
   emits perfect heartbeats from a corpse. Never accept a self-report as
   the *only* instrument for a tool that can emit anything better.

Silence on all channels past the threshold is a fact about the
*instruments*, and the host's claim must degrade accordingly — "no
observed activity since T", not "running fine" and not "failed". Promoting
silence to either comfortable extreme is the liveness form of
[failure spelled as empty success](../../_laws.md#failure-not-empty-success).

**And the instrument itself must distinguish two silences.** At the output
channel, "the pipe closed with nothing more to say" and "the pipe is open
and nothing has arrived for the whole window" are opposite facts: the
first means the child is exiting normally and the host should proceed to
the reap; the second means the child is holding its channel open with
nothing to say — wedged, not finishing. A read primitive that collapses
both into one "no data" result forces every caller to treat the wedged
case as the finishing case, which ends with the host blocked forever on a
wait that never returns. Type the two endings differently at the lowest
read layer, and the entire stall machinery above inherits the
distinction for free.

## Stalled versus slow

The threshold question is the technique's hard center, because the cost of
each mistake is asymmetric: killing a slow-but-honest run destroys real
work; babysitting a stalled one wastes a slot and the user's time.
Principles:

- **Thresholds are per tool class, not universal.** A formatter that has
  been silent for two minutes is dead; a compiler at two minutes is
  normal. The spawn door knows the class; it registers the threshold with
  the liveness record.
- **Silence starts the clock; it does not fire the kill.** The stall
  threshold triggers *investigation posture*: the claim degrades, cheaper
  instruments are consulted (consumption, artifacts), the user is shown
  the honest state and offered the cancel.
- **Only the ceiling kills.** The hard per-run timeout
  ([host-resource-protection](host-resource-protection.md)) remains the
  sole automatic executioner; the stall detector is an early-warning
  system feeding humans and records, not a second, twitchier killer. A
  design with two independent kill authorities produces exactly the
  kill-races and double-records the termination ladder exists to prevent.
- **Expected-quiet phases are declared, not discovered.** Tools with known
  silent phases (long initial load, a final fsync) get those phases
  declared in their class profile, so the detector does not cry wolf at
  the same minute of every run — the fastest way to teach operators to
  ignore it.

## The stall ledger

Every stall episode — run identity, silence duration, which instrument
finally moved or which rung ended it — is recorded even when the run
recovers. Recovered stalls are the leading indicator: a tool whose runs
routinely go silent for 4 minutes against a 5-minute threshold is one
regression from an epidemic of false kills, and only the ledger shows the
margin shrinking. This is also the data that earns threshold changes —
adjusting a stall threshold from anecdote is how both failure modes get
worse at once.

## The watcher is also watched

Stall detection is itself a recurring loop with the standard obligations —
registered, supervised, and visible in the host's own health surface —
because a dead stall detector over a fleet of silent children reads
exactly like a healthy quiet system. The recurring-loop machinery is
[background-jobs](../../background-jobs/background-jobs.md)'s subject; the
liveness loop is simply one of its registered customers.
