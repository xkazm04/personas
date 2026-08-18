---
layer: technique
subject: fleet-orchestration
technique: hibernation-and-resume
status: forged
laws: [identity-survives-reuse, creation-names-reaper, one-validation-door]
shared_with: []
---

# Hibernation and resume

Hibernation decouples "this session exists" from "this session is consuming a
process slot." A hibernated session has no process, no stream, no terminal —
and full standing in the registry: its identity, its task binding, its
accumulated context, and its lineage all persist, waiting. Resume mints a new
process under the old identity and continues. Done right, this is the
technique that lets a fleet's roster grow past the machine's concurrency
ceiling by an order of magnitude; done wrong, it produces the two silent
disasters of fleet systems — the duplicate (two processes both believing they
are the session) and the changeling (a resumed process that is actually a
fresh start wearing the old identity).

## Park: an ordered transition, not a kill

Parking a session is a registry transition with a fixed sequence, all of it
behind the one transition door
([one door](../../_laws.md#one-validation-door)):

1. **Quiesce.** The session finishes or checkpoints its in-flight step. A
   park that lands mid-write leaves the write scope in a state the resumed
   session cannot distinguish from someone else's interference. If the
   session cannot quiesce within a bounded grace, the park is downgraded to
   a recorded interrupt — honest, and visible at resume.
2. **Capture the resume contract.** Everything the wake will need, stored
   durably against the session's identity: the conversational/task context
   or a pointer to where the session's own runtime persists it, the working
   directory, the task binding, and the declared write scope as it stood.
3. **Release what does not survive.** The concurrency slot, always. The
   terminal or stream attachment, always. The write-scope claim — a policy
   decision with two legitimate answers: *keep* it reserved (the parked
   session will continue that work; nobody else may enter) or *release* it
   (the park is indefinite; holding scope hostage to a sleeping session
   starves the fleet). Choose per park, record the choice; the default
   should be release, because reserved-by-the-sleeping is a leak wearing a
   justification ([creation names its
   reaper](../../_laws.md#creation-names-reaper) — a claim held by no live
   process must name what releases it, and "the resume, someday" is rarely
   an acceptable reaper).
4. **End the process.** Only after the contract is captured. The ordering is
   the whole point: kill-then-capture is a crash with paperwork.

What survives a park is exactly the resume contract; everything else is
declared dead at step 3. The discipline of enumerating the two sets — kept
versus released — per session type is what makes hibernation a state instead
of a euphemism for "killed, hopefully recoverable."

**Two park depths earn their keep.** Deep park is the explicit hibernated
state above. The lighter variant — call it dozing — frees the process but
deliberately *preserves the displayed state* the session was parked in: the
entry still reads as what it was doing, carries a small sleep marker, and
wakes in place when selected. Doze is the right shape for policy-driven
parking (idle eviction, slot pressure), where the operator never asked for
anything and should not see their fleet visibly rearranged; explicit
hibernation is the right shape for a deliberate operator act. The bonus of
having doze in the vocabulary: **restart recovery gets a state for free** — a
session restored from the durable mirror with no live process *is* a dozing
entry, and reusing the doze-wake path for recovery means no new state, no
new UI concept, and no second wake mechanism to keep correct.

**Policy parking must re-validate inside the transition.** An eviction pass
picks its victims from a snapshot — least-recently-active, resting states
only — but a session can leave the resting state between the snapshot and
the park (a signal arrived; it is now working). The park operation therefore
re-checks eligibility *inside the registry's lock*, as part of the
transition itself, and declines if the session woke up. Never sleep a live
turn: parking a session mid-work is exactly the in-flight-work loss the
resting-only rule exists to prevent, and a check that ran before the lock is
a check against a world that may have moved.

## Wake: resume is identity work

Resume's obligations, in order:

1. **Check the edge.** Only a hibernated entry may be woken; the door rejects
   wake on any other state. This single check structurally prevents the
   duplicate — a second process can never be minted under an identity that
   already has one.
2. **Reclaim resources under current rules.** A slot must be available (a
   wake is a dispatch, and it queues like one when the fleet is at cap); the
   write scope must be re-acquired — and re-*validated*, because the world
   may have moved while the session slept. If another session legitimately
   entered a released scope and finished, the resumed session's first duty
   is to observe the changed ground truth, not to resume writing over it.
3. **Restore from the resume contract, and verify the restoration.** The new
   process is started with the stored context. The critical test: the
   resumed session must demonstrably *be a continuation* — it holds the
   prior context, knows its task position, and its first output should be
   checkable against the contract (it references the task it was parked on).
   A runtime that silently fails to load the context and starts fresh under
   the old identity is the changeling: it passes every liveness check while
   having lost everything that made the identity worth preserving
   ([identity-survives-reuse](../../_laws.md#identity-survives-reuse) cuts
   both ways — the identity must survive, and the identity must still
   *mean* the same session).
4. **Record lineage.** The entry's history says parked-then-resumed, with
   both timestamps and the process facts of each incarnation. Debugging a
   session that misbehaves after its third resume requires knowing there
   were three.

## Policy: who parks, and when

Hibernation earns its complexity only if it is actually used, so the triggers
should be explicit fleet policy rather than operator heroics:

- **Idle-parking.** A session idle past a budget is parked automatically —
  the highest-value trigger, because idle sessions holding slots are the
  fleet's dominant waste.
- **Pressure-parking.** At the concurrency cap, the dispatcher may park the
  least-recently-active idle session to admit new work — a cache-eviction
  policy over sessions.
- **End-of-run parking.** A fleet run that completes its harvest can park
  its sessions rather than kill them when the same roster is likely to be
  redispatched; warm context is the asset being conserved.
- **Never park the waiting.** A session awaiting human input is a promise to
  a person; parking it silently converts "the fleet is waiting for you"
  into "your answer will go nowhere." Either surface the pending question
  through the harvest/notification path first, or leave it running.

The counterweight: a hibernated session is not free. Its resume contract is
storage, its reserved scope (if reserved) is contention, and a graveyard of
hundreds of parked sessions nobody will ever wake is clutter that degrades
every registry walk. Hibernated entries get a retention policy — age out to
a terminal archived state, with their harvestable results extracted first —
because everything created names its reaper, including the sleeping.
