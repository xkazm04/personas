---
layer: golden-path
subject: subprocess-lifecycle
status: forged
techniques:
  - spawn-contract
  - termination-and-reaping
  - concurrency-and-slots
  - session-reuse
  - liveness-and-heartbeats
  - host-resource-protection
evidence:
  - src-tauri/engine/src/cli_process.rs                  # one spawn door: shared envelope, kill-on-drop backstop, EOF-vs-silence read primitive, deliberate executable resolution
  - src-tauri/engine/src/prompt/cli_args.rs              # argv/env construction in one place; nested-deadline alignment (inner API timeout derived from outer kill ceiling)
  - src-tauri/engine/src/process_activity.rs             # activity events keyed by run_id — the shared-key collapse documented in the serde comment
  - src-tauri/engine/src/session_pool.rs                 # warm sessions: canonical config fingerprint, TTL, consume-once, invalidate on change/failure
  - src-tauri/engine/src/queue.rs                        # layered caps: global + per-tenant, bounded queue with backpressure, quota + resource admission gates
  - src-tauri/src/engine/resource_governor.rs            # pressure-aware admission with hysteresis and asymmetric per-signal watermarks
  - src-tauri/src/commands/fleet/stale.rs                # eviction-side live-slot cap (soft, never evicts working sessions) + stall/frozen detection
  - src-tauri/src/webbuild/devserver.rs                  # process-tree kill; verify-identity-before-kill on the crash-orphaned lock
  - scripts/build/guard-concurrent-cargo.mjs             # machine-scoped exclusion across host instances via stateless live-population check, fail-open loudly
counter_evidence:
  - src-tauri/src/commands/fleet/process_scan.rs         # orphan detection by name/cmdline heuristic — the identity-marker sweep the standard prescribes does not exist
deviations:
  - w4-subprocess-lifecycle   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Subprocess & CLI session lifecycle

This is the subject you own when a long-lived host program runs **external
child processes** as part of its work: tool invocations, build steps, agent
runtimes, interpreters, sidecar services. The host outlives its children by
design — it will spawn thousands of them over its lifetime, often **many at
once** — and every one of them is a real operating-system resource with a
security boundary at its birth, an independent will during its life, and a
non-optional funeral at its end.

The boundary with the neighboring subject is precise: this subject owns the
**process** — spawn, supervise, admit, terminate, reap. What comes *out* of
the process on its output channels — parsing it, buffering it, rendering it
live — is [streaming-output](../streaming-output/streaming-output.md)'s
subject. The handoff is the standard-stream wiring decided at spawn time:
this subject decides *that* the pipes exist and who holds their ends;
streaming-output owns everything that flows through them. Likewise, recurring
work hosted *inside* the process as tasks is
[background-jobs](../background-jobs/background-jobs.md); this subject begins
where the work crosses a process boundary and the operating system, not the
runtime, becomes the supervisor of record.

Three facts make this subject harder than it looks:

1. **A child is not a function call.** It does not unwind with your stack, it
   does not stop when you stop caring about it, and its failure modes include
   several — killed by the platform, orphaned by a host crash, alive but
   silent — that no in-process abstraction has.
2. **The host is shared.** Every child competes with its siblings *and with
   the host itself* for cores, memory, disk, and — most treacherously — for
   mutable resources like caches and working directories that were never
   designed for concurrent writers.
3. **Children outlive intentions.** The host crashes, restarts, or is killed;
   the children it spawned do not notice. A design that only handles the
   host-outlives-child direction is half a design.

## The spawn is a security and correctness boundary

Everything the child will be is decided in the spawn call: its argument
vector, its environment, its working directory, its standard-stream wiring.
Each of these is a **contract**, and each has a default that is wrong for a
production host:

- The default argument path — concatenate a command string and hand it to a
  shell — is an injection engine.
- The default environment — inherit the host's — is a leak surface: the
  host's secrets, its tooling configuration, its locale accidents, all become
  the child's ambient truth.
- The default executable resolution — first match on the ambient search path
  — executes whatever a writable directory earlier in that path decided to
  call by the expected name.
- The default working directory — wherever the host happens to be — makes
  the child's relative-path behavior a function of host history.

The [spawn-contract](techniques/spawn-contract.md) technique owns all four,
and the structural rule above them: **one spawn door**. Every launch in the
host passes through a single constructor that applies the hardening
uniformly, because a spawn site added next quarter inherits exactly the
discipline of the door it goes through — and nothing else.

## Every child names its reaper

The law is general
([creation-names-reaper](../_laws.md#creation-names-reaper)); for processes
it is unusually literal. At the moment of spawn, the design must answer:

- **Who kills this child if the operation is cancelled?** Cancellation racing
  against completion is the normal case, not the exception.
- **Who kills it if the host's handle to it is dropped** — an error path, an
  early return, a panic? Kill-on-drop backstops are the difference between an
  exception and a leaked process.
- **Who kills its descendants?** A child that spawns its own children creates
  a process *tree*; terminating only the root detaches the rest into
  invisible orphans that keep the ports, the locks, and the CPU.
- **Who cleans up after a host crash?** The host cannot reap what it did not
  survive to see. The answer is a **startup orphan sweep**: children are
  spawned with a durable identity marker, and every host start scans for
  marked survivors from previous incarnations and retires them — verifying
  identity before killing, because process ids are recycled.

Termination itself is a designed path, not an afterthought: a polite stop
request first, a deadline second, a forcible kill third, and an honest record
of which rung was needed. The
[termination-and-reaping](techniques/termination-and-reaping.md) technique
owns the ladder, the races, and exit honesty — the discipline that "the child
ended" is never collapsed into "the child succeeded"
([failure-not-empty-success](../_laws.md#failure-not-empty-success)).

## The parallel dimension: N children, one host

A host that runs one child at a time is the textbook case; a production host
runs **many concurrently**, and the concurrency is not an add-on — it is a
first-class dimension with its own machinery:

- **Admission before spawn.** A spawn is a commitment of cores, memory, and
  descriptor table entries. The host admits a new child by acquiring a
  **slot** from a bounded scheduler before the process exists — never by
  spawning first and hoping the machine copes. (Where children are cheaply
  resumable, the cap may instead be enforced by *reclaiming* an idle child's
  slot for the newcomer — the technique covers both postures.)
- **Caps at more than one grain.** A global cap protects the machine; per-class
  and per-tenant caps protect *fairness* — without them, one eager consumer
  queues fifty children and starves every other consumer while the global cap
  reads healthy.
- **Disjoint mutable ownership.** Concurrent children must not share a
  writable resource — a working directory, a scratch cache, a port, a session
  file — unless that resource was designed for concurrent writers. The
  standard posture is per-child private scratch space plus shared *read-only*
  inputs; anything else needs an explicit exclusion mechanism.
- **The host is not alone.** Other host instances — parallel sessions,
  sibling tools, a second launch — spawn children onto the same machine
  against the same caches and locks. Machine-scoped exclusion (advisory lock
  files with liveness checks) is the only cap that can see across process
  boundaries.

The [concurrency-and-slots](techniques/concurrency-and-slots.md) technique
owns admission, caps, fairness, and the ownership matrix. Composing many
hosts' children across machines is a different subject (fleet-orchestration,
as is multiplexing many interactive children into shared terminals —
terminal-multiplexing); this subject's jurisdiction ends at one host's
machine.

## Sessions: the economics of not spawning

Some children are cheap; some cost seconds of startup — runtime
initialization, model loading, workspace indexing — before the first useful
byte. For those, the unit of reuse is the **session**: a child (or its
resumable state) kept warm across requests, so the next request pays
marginal cost instead of cold-start cost.

Reuse is an economics decision with a correctness bill attached. A warm
session embodies the configuration it was created under; reusing it after
*anything* that shaped it has changed — binary version, flags, environment,
workspace contents — serves answers from a world that no longer exists. So a
session is keyed by a **configuration fingerprint**, is invalidated the
moment the fingerprint stops matching, and is invalidated *unconditionally*
on failure: a session that just misbehaved has forfeited the presumption of
reusability. The [session-reuse](techniques/session-reuse.md) technique owns
the pool, the fingerprint, and the invalidation triggers.

## Liveness: the child that is alive but not working

Between "running" and "exited" sits the state that ruins operations:
**silent**. A child can be alive, consuming a slot, and making no progress —
deadlocked, waiting on a prompt nobody will answer, looping. The host must
distinguish *stalled* from *slow*, and the only honest instrument is
**activity keyed by run identity**: events that this specific run produced
recently, not "the process exists" (which proves nothing) and not a global
activity light (which one chatty sibling keeps green for everyone). Silence
past a threshold degrades the host's claim about the run and starts the
escalation clock. The
[liveness-and-heartbeats](techniques/liveness-and-heartbeats.md) technique
owns the signals, the thresholds, and the stalled-versus-slow distinction.

## The host survives its children

The final invariant inverts the usual sympathy: children are expendable, the
host is not. A host that dies of a child's appetite takes every other child,
every queued request, and the user's session with it. Three consequences:

- **Every child runs under a ceiling** — a per-run timeout that is a
  generous *ceiling*, never a tuned estimate. When it fires, the designed
  termination path runs; the record says "exceeded its ceiling", not
  "failed".
- **Admission consults the machine.** When memory or CPU pressure is real,
  the host defers new spawns — with hysteresis, so the gate does not flap at
  the threshold — rather than adding a child to a machine already drowning.
- **Budgets are per-child.** Output volume, scratch-disk growth, memory: a
  child exceeding its budget is terminated by policy, not discovered by the
  host's own death.

The [host-resource-protection](techniques/host-resource-protection.md)
technique owns ceilings, admission, and budgets. Retrying what the ladder
killed is [retry-backoff](../retry-backoff/retry-backoff.md)'s subject;
deciding *when* recurring child work runs at all is
[scheduling](../scheduling/scheduling.md)'s.

## The child lifecycle

A child is always in exactly one of these states, and every transition is
owned by named code:

| State | Meaning | The host's obligations |
| --- | --- | --- |
| **queued** | admitted to the queue, no slot yet | fair ordering; the requester can cancel a queued entry without side effects |
| **spawning** | slot held, process being created | spawn failure releases the slot and reports as its own outcome, distinct from any exit |
| **running** | alive, activity current | liveness tracking keyed to this run; stop control armed |
| **stalled** | alive, silent past threshold | claim degraded; escalation clock running |
| **terminating** | stop requested, ladder in progress | polite → deadline → kill; descendants included |
| **reaped** | exit collected, outcome recorded | slot released, scratch space scheduled for cleanup, outcome from the closed vocabulary |
| **orphaned** | host died first | found and retired by the next incarnation's sweep, by identity marker |

Two rules fall out of the table:

1. **Reaping is unconditional.** Every spawned child is eventually waited on
   — success, failure, kill, or sweep — because an unreaped child is a
   resource leak on every platform and a bookkeeping lie on all of them. The
   slot, the scratch space, and the liveness entry are all released *by the
   reap*, which is why a skipped reap quietly shrinks the host's capacity
   forever.
2. **Outcome is a closed vocabulary.** Completed, failed-by-exit-code,
   killed-by-ceiling, cancelled-by-user, spawn-failed, lost-to-host-crash:
   these route to different next actions and must never collapse into a
   boolean.

## The techniques

- [spawn-contract](techniques/spawn-contract.md) — argument vectors, minimal
  environments, deliberate executable resolution, working-directory
  discipline, the one spawn door.
- [termination-and-reaping](techniques/termination-and-reaping.md) — the
  graceful→deadline→kill ladder, cancellation races, kill-on-drop backstops,
  process-tree kill, orphan sweeps, exit honesty.
- [concurrency-and-slots](techniques/concurrency-and-slots.md) — bounded slot
  schedulers, layered caps, fairness, disjoint mutable ownership,
  machine-scoped exclusion across host instances.
- [session-reuse](techniques/session-reuse.md) — warm-session pools,
  configuration fingerprints, invalidate-on-change and invalidate-on-failure.
- [liveness-and-heartbeats](techniques/liveness-and-heartbeats.md) — activity
  keyed by run identity, stalled versus slow, escalation.
- [host-resource-protection](techniques/host-resource-protection.md) —
  timeout ceilings, pressure-aware admission with hysteresis, per-child
  budgets.
