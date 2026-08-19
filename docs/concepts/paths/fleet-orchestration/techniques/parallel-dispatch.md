---
layer: technique
subject: fleet-orchestration
technique: parallel-dispatch
status: forged
laws: [gate-sees-target, one-validation-door, creation-names-reaper, count-carries-predicate]
shared_with: []
---

# Parallel dispatch

Dispatch is the fleet's admission control: the one door through which
sessions come into existence, singly or in waves. Its three responsibilities
are inseparable — **capacity** (how many may run), **assignment** (who may
write where), and **accounting** (a roster the harvest can later audit). A
dispatcher that handles capacity but not assignment produces fast corruption;
one that handles assignment but not accounting produces runs that cannot be
declared finished. This technique treats spawn-one as the degenerate case of
spawn-many, because a fleet whose parallel path is a bolted-on afterthought
will route its important work through the unhardened single path forever.

## The slot scheduler

The machine hosts a bounded number of live sessions — bounded by memory, by
the cost ceiling of concurrent agent runtimes, by the operator's attention.
The cap is **fleet policy enforced at the dispatch door**, never a courtesy
callers observe ([one door](../../_laws.md#one-validation-door)): every
launch request, including wakes from hibernation and adoptions at recovery,
passes the same admission check.

- **Admit to cap, queue beyond it.** The queue is ordered and visible; a
  queued dispatch is a registry entry in a pre-life state, not a closure
  waiting in memory — the queue must survive an orchestrator restart like
  everything else.
- **Slots are released by the state machine, not by goodwill.** Any
  transition out of the live states — exit, failure, loss, hibernation —
  frees the slot as part of the transition itself. The classic leak is the
  session the sweeper declared lost whose slot nobody freed; at cap, each
  leaked slot permanently shrinks the fleet, and the shrinkage is invisible
  until throughput has quietly halved.
- **Promotion is dispatch.** When a slot frees, the queue head goes through
  full admission — including write-scope validation, because the world
  changed while it waited.

## The address: derive it from the work, not the attempt

A dispatch is not finished when the session starts; it is finished when the
surface that started it — and every surface that comes later — can find the
session again. The discipline that makes this cheap: **compute a dispatch
key as a pure function of the entities the work is about** (which project,
which item, which scope), check it against the registry before spawning
(advisory — see below), spawn, and bind the key to the session *in the same
breath*, with no branch between spawn and naming. Then persist the key onto
the domain object the work concerns.

Why a derived key and not the session id the spawn returns: an id minted at
spawn can only be *remembered*, and the surfaces that need it most — a
watcher built later, a view opened after a restart, a component that
unmounted — have no memory. A key derived from the request can be
*recomputed* by anything holding the same entities, forever. The key also
answers deduplication ("is one already running for this scope?") and
readback ("did the one for this scope finish?") as the same question. Two
cautions, both structural: the scope belongs *in* the key when scoped
fan-outs of one parent are meant to run concurrently (a parent-level key
makes deliberate siblings collide as duplicates); and a registry-check
followed by a spawn is check-then-act, not a lock — two concurrent callers
both get "not running." Treat the check as advisory, put the synchronous
double-fire guard on the control itself, and let the registry's one
admission door be the arbiter when it matters
([one door](../../_laws.md#one-validation-door)). A session spawned and
never named is anonymous exactly during the window when every recovery
mechanism is blind to it — if naming can fail, treat that as the dispatch
failing.

## Assignment: collision domains first

The charter fact of this subject: many sessions share one repository, one
host, one filesystem. The only cheap time to handle a write collision is
*before* it exists. Each dispatch declares a **write set** — the files,
directories, branches, or records the session is authorized to modify — and
the dispatcher's admission check proves the new set disjoint from every live
session's set before the session exists. Overlap is a dispatch-time rejection
(or a queueing decision: wait until the holder finishes), never a runtime
surprise.

Making disjointness real rather than aspirational:

- **Partition by design, not by hope.** When one goal fans out to many
  sessions, the split is chosen so write sets fall out disjoint naturally —
  by module, by directory, by record range. A partition that requires two
  sessions to edit the same file was a wrong partition; redraw it rather
  than "coordinating."
- **Shared ground is read-only ground.** Everything outside a session's
  write set is readable and untouchable. The instruction is explicit in the
  session's task, and the declared set is recorded in the registry — the
  audit trail for any later "who wrote this."
- **The narrow shared tails need a protocol, not vigilance.** Even perfectly
  partitioned work often converges on one shared integration act — a
  version-control commit, a shared ledger update, a manifest regeneration.
  Those tails are where disjointness structurally fails, and they get an
  explicit mechanism (an isolated staging area per session, an append-only
  ledger, a single-writer integration step) owned by the concurrent
  version-control discipline this subject borrows rather than owns — see
  the sibling subject concurrent-vcs.

## Verify after every irreversible act

Declared disjointness is a plan; sessions are autonomous, and plans decay.
The dispatcher pairs assignment with a standing verification ritual, imposed
on every session's task: **after each irreversible act, confirm the result is
yours** — the landed change contains your work and only your work, the
record you appended carries your identity, the artifact you produced matches
what you staged. The check must read the actual outcome, not the tool's
success message: shared-state races routinely produce a green status for an
act that silently swept in a neighbor's work or landed nothing at all
([the gate must see its target](../../_laws.md#gate-sees-target)). A
collision caught at the next step is an amend; a collision caught never is
two sessions' work fused under one attribution, discovered at review — or
after it.

When verification fails, the recovery rule is *repair attribution, don't
rewind shared state*: the content is usually present and merely mislabeled,
and rewinding a shared timeline to fix a label destroys neighbors' landed
work — a worse collision than the original.

## Broadcast and spawn-many

Fanning one task across many targets (the same audit against every module;
the same fix across every consumer) adds roster semantics on top of
single dispatch:

- **The wave is an entity.** A broadcast mints a run identity, and every
  member session's registry entry carries it. The run is what the harvest
  will account against; without it, "did the wave finish?" has no referent
  ([a count carries its predicate](../../_laws.md#count-carries-predicate) —
  "eight sessions succeeded" means nothing without "of the eleven
  dispatched in run R").
- **Members are independent failures.** One member failing neither aborts
  nor blocks its siblings by default; the run-level policy (proceed,
  abort-remaining, pause-for-human) is declared at dispatch, not improvised
  mid-wave.
- **The wave respects the cap.** Spawn-many is admitted through the same
  slot scheduler, as a queue of admissions, not an exemption from it. A
  broadcast of forty against a cap of eight is a rolling wave by
  construction.
- **Every member names its reaper at mint time.** Timeout budget, straggler
  policy, and who kills an overrunner are set per-member at dispatch
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)); a wave
  without per-member deadlines is a wave whose completion time is its
  slowest ghost.
