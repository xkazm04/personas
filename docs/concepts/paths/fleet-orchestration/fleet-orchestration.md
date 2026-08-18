---
layer: golden-path
subject: fleet-orchestration
status: forged
techniques:
  - session-registry
  - lifecycle-signals
  - durable-fleet-state
  - hibernation-and-resume
  - parallel-dispatch
  - result-harvest
evidence:
  - src-tauri/src/commands/fleet/registry.rs      # the one registry: guarded transition methods, output rings, lineage adoption
  - src-tauri/src/commands/fleet/types.rs         # closed state vocabulary + token round-trip (unknown token → skipped, never mislabelled)
  - src-tauri/src/commands/fleet/stale.rs         # staleness ticker: per-provenance activity signals, spurious-await revival, live-slot eviction
  - src-tauri/src/commands/fleet/persist.rs       # durable mirror piggybacking the two emit points; rehydrate + recover_after_restart
  - src-tauri/src/commands/fleet/run.rs           # harvest: run identity stamped at spawn, declared-summary-only aggregation
  - src/features/fleet/monitor/monitorModel.ts    # fleet-level derived view: priority-resolved read model over the registry vocabulary
counter_evidence:
  - src-tauri/src/commands/fleet/external.rs      # the deliberately non-addressable lane — handle dropped by written design; the exception that proves the registry rule
deviations:
  - w4-fleet-orchestration   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Agent fleet orchestration

One autonomous agent session is a process with a job. Ten of them, launched
over hours, working different tasks in different directories, some watched in
a terminal and some running headless, some parked for the night and some
racing a deadline — that is a **fleet**, and a fleet is a different problem
than any one of its members. The member-level problem — how one child process
is spawned, wired to its terminal or its output stream, killed, and reaped —
belongs to the sibling subject subprocess-lifecycle. This subject owns the
layer above: the registry that knows what the fleet *is*, the lifecycle model
that tracks what each session is *doing*, the dispatch machinery that starts
many sessions safely, the durability that lets the whole fleet survive an
orchestrator restart, and the harvest phase that turns N scattered results
into one answer.

The dividing line is worth stating precisely, because it is where fleet
systems rot first. Subprocess-lifecycle answers "is this process alive and how
do I end it." Fleet orchestration answers "what sessions exist, what state is
each in, who may write where, and what did we collectively produce." When the
second set of questions gets answered by reaching down into the first — by
polling process tables, by treating a live process handle as the session
record — the fleet's knowledge dies with every restart and every process that
outlives its parent becomes invisible. The registry, not the process table, is
the fleet's memory.

## The central claim: one registry, one state machine

Everything in this subject radiates from a single structural decision: **the
fleet has exactly one authoritative registry, and that registry is a state
machine, not a cache.** Every session, however it was started — interactively
from a terminal panel, headlessly from an automation, resurrected from
hibernation, adopted from a previous run — exists as exactly one entry, keyed
by an identity minted at creation and never reused
([identity-survives-reuse](../_laws.md#identity-survives-reuse)). Every
question anyone asks about the fleet — a dashboard, a dispatcher deciding
whether there is capacity, a sweeper hunting the stalled, a harvest collecting
results — is answered by reading the registry, never by re-deriving fleet
state from processes, files, or logs.

The registry's status vocabulary is **closed and single-sourced**
([one authority per vocabulary](../_laws.md#one-authority-per-vocabulary)).
The set of states a session can occupy — starting, working, awaiting input,
idle, hibernated, exited, failed, lost — is defined once, and every producer
and consumer derives from that one definition. The moment a monitoring view
maintains its own informal state list ("probably done", "looks stuck"), the
fleet has two truths, and the operator learns which one is wrong at the worst
possible time.

Two properties make the registry a state machine rather than a bag of rows:

1. **Transitions are legal or rejected.** A session moves between states along
   defined edges — working may become awaiting-input, exited may not become
   working — and the registry is the one door through which every transition
   passes ([one validation door](../_laws.md#one-validation-door)). Writers do
   not poke status fields; they report events, and the registry decides what
   the event means from the state the session is actually in.
2. **Ownership is part of the record.** Each entry names the resources the
   session holds — its working directory, its write scope, its terminal
   attachment, its slot in the concurrency budget — so that "who may touch
   this" and "what must be released when this ends" are registry questions
   with registry answers ([creation names its
   reaper](../_laws.md#creation-names-reaper), fleet-wide: every session's
   entry states what reclaims its resources and when).

**The drive medium is a mode, not a second state machine.** Fleets typically
grow two lanes for the same kind of session: an interactive one attached to a
real terminal for a human to watch, and a headless one speaking a structured
event stream for automation to drive — cheaper per session, with no rendering
loop to feed. The temptation is to model these as different kinds of entity
with different lifecycles. Resist it: the lane is one field on the entry, and
both lanes share the identical state vocabulary, the same transition rules,
the same durable record, and ideally the same underlying conversation — so a
session started headless can be woken interactively when a human wants to
step in, and everything watching the fleet is lane-blind. Two state machines
for one concept is the [vocabulary law](../_laws.md#one-authority-per-vocabulary)
violated at the schema level, and it is much harder to unwind later than to
avoid now.

## Lifecycle: signals first, sweeper second

How does the registry *know* a session moved? The standard is a two-tier
answer, and both tiers are mandatory.

**Tier one: the sessions tell you.** The richest, fastest, most precise
lifecycle information comes from the sessions themselves — the lifecycle
events their runtime emits, the hooks that fire on state changes, the
structured markers in their output streams. These signals drive the primary
transitions: they arrive promptly, they carry intent (this session is now
waiting for a human, not merely quiet), and they cost nothing to collect
beyond listening.

**Tier two: the sweeper assumes they lied.** Signals are delivered by
processes that crash, streams that close mid-line, and hooks that never fire
because the session died before reaching them. A fleet that trusts signals
alone will accumulate ghosts — entries frozen in "working" whose processes
died days ago. So a periodic staleness sweep walks the registry and asks the
cheap, brutal questions: is the process behind this entry still alive? has
this session emitted anything within its staleness budget? The sweeper fills
exactly the gaps signals leave, and it marks what it finds with its own
honest vocabulary — a session it declares dead is *lost*, not *exited*,
because "we stopped hearing from it" and "it told us it finished" are
different facts and must stay different
([failure ≠ empty success](../_laws.md#failure-not-empty-success)). The
sweeper is a supervised recurring loop and inherits all the obligations of
one — registration, isolation, its own health signal — from
[background-jobs](../background-jobs/background-jobs.md).

The two tiers must agree on the vocabulary and disagree on nothing else. A
signal and a sweep that map the same observation to different states create a
flapping session that is "working" on the event channel and "lost" on the
sweep channel; the cure is that both write through the registry's one
transition door, which arbitrates.

## Hibernation is a state, not a death

Long-lived fleets outlive any single working day. The naive lifecycle —
sessions are either running or gone — forces a false choice at the end of the
day: keep paying for idle processes, or kill them and lose their
accumulated context. The standard adds a first-class **hibernated** state:
the process is gone, but the session is not. Its identity, its conversational
and task context, its resource claims (or an explicit release of them), and
its place in the registry all survive; resurrection creates a *new process*
under the *same session identity*, resuming where the parked session stopped.
Hibernation is what makes a fleet of dozens affordable: the registry can hold
far more sessions than the machine can run, because "exists" and "is
consuming a process slot" are decoupled. The design questions — what survives
the park, who releases which resources, how a wake proves it resumed the
right session — are the
[hibernation-and-resume](techniques/hibernation-and-resume.md) technique.

## Dispatch is designed around collision domains

This system's charter makes parallelism first-class: spawn-many, broadcast a
task to a set of sessions, run concurrent sessions against one repository on
one host. The enabling discipline is thinking in **collision domains**: for
each session, what is the set of things it may write — files, branches,
records, external resources — and the orchestrator's job is to make those
sets provably disjoint *before* dispatch, or to detect and repair the
collision when disjointness fails. Disjointness is a plan, not a property of
the universe: it holds only as long as every session honors its declared
scope, so the dispatcher pairs the up-front assignment with a cheap
verification ritual after every irreversible act — check that what landed is
what you wrote, because a collision discovered one step late is recoverable
and one discovered never is silent corruption
([the gate must see its target](../_laws.md#gate-sees-target)).

Dispatch also owns the **concurrency budget**: the machine can host a bounded
number of live sessions, so the dispatcher runs a slot scheduler — admit
until the cap, queue the rest, promote as slots free. The cap is a fleet
policy, enforced at the one dispatch door, never a courtesy each caller is
trusted to observe. Slot accounting is registry state like everything else:
a session that hibernates releases its slot; a session the sweeper declares
lost releases its slot *through the same transition machinery*, or the fleet
slowly strangles itself on slots held by ghosts.

## Harvest is a phase, not a hope

A fleet run that fans out N sessions has not finished when the last session
exits; it has finished when the orchestrator has **collected, classified, and
aggregated** what came back. Harvest is the orchestrator's explicit final
phase: gather each session's declared result, account for every member of the
dispatch roster — succeeded, failed, produced-nothing, still-straggling — and
compose the run-level answer with its bookkeeping attached: "seven of nine
produced results; two failed, named; one timed out" is a harvest, "here are
some results" is not ([a count carries its
predicate](../_laws.md#count-carries-predicate)). The alternative — each
caller scrapes outputs from wherever its sessions left them — is how fleets
produce the worst failure mode they have: a run that looks complete because
nobody was accountable for noticing the missing third of it. Stragglers get a
policy, not an infinite wait; partial failure is a first-class outcome with
its own shape, distinct from success and from total failure.

## Invariants

- **The registry is the only truth, and it survives restart.** In-memory
  state is mirrored durably as it changes, and orchestrator startup
  reconciles the mirror against reality — adopting sessions that survived,
  declaring lost the ones that did not — before accepting new work. A fleet
  that evaporates when its orchestrator restarts is not a fleet; it is a
  process group with a dashboard.
- **Every state the fleet can express is in one closed vocabulary.** No
  consumer invents states; no producer writes states the machine does not
  define.
- **A silent session becomes visible because it is silent.** The staleness
  sweep guarantees an upper bound on how long a dead session can impersonate
  a working one.
- **Identity is minted once and survives everything** — restart of the
  orchestrator, hibernation and wake, re-attachment of a viewer, adoption
  after a crash. Process ids are process facts; session identity is a fleet
  fact, and the two are joined in the registry, never conflated.
- **Concurrent sessions have declared, disjoint write scopes** — and where
  disjointness cannot be guaranteed, the collision is detected and named, not
  absorbed.
- **Every dispatch roster is fully accounted for at harvest.** No session
  simply falls off the ledger; each ends in a terminal state someone can
  read.

## The techniques

- [session-registry](techniques/session-registry.md) — the one authoritative
  state machine: entry shape, closed status vocabulary, legal transitions,
  resource ownership rules, the single transition door.
- [lifecycle-signals](techniques/lifecycle-signals.md) — event- and
  hook-driven transitions as the primary channel, the staleness sweeper as
  the gap-filler, and how the two are kept in agreement.
- [durable-fleet-state](techniques/durable-fleet-state.md) — the durable
  mirror written by piggybacking existing emit points, restart recovery, and
  ghost-session reconciliation.
- [hibernation-and-resume](techniques/hibernation-and-resume.md) — park and
  wake semantics: what survives hibernation, what is released, and how
  resume proves identity.
- [parallel-dispatch](techniques/parallel-dispatch.md) — spawn-many and
  broadcast, the slot cap, disjoint write-set assignment, and collision
  detection when disjointness fails.
- [result-harvest](techniques/result-harvest.md) — per-session results into
  a run-level aggregate, partial-failure accounting, and the straggler
  policy.
