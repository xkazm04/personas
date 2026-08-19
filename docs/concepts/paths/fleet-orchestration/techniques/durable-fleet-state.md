---
layer: technique
subject: fleet-orchestration
technique: durable-fleet-state
status: forged
laws: [gate-sees-target, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Durable fleet state

The registry's working truth lives in memory, because lifecycle decisions are
made at memory speed and the state machine needs atomic read-modify-write
over an entry. But an orchestrator restarts — crashes, upgrades, is closed at
the end of the day — and its sessions frequently *outlive* it: they are
independent processes, and some were hibernated with the explicit promise of
coming back. A fleet whose knowledge lives only in the orchestrator's memory
breaks that promise on every restart. The durable mirror is the fix: a
persistent copy of the registry, maintained continuously, read exactly once
per orchestrator lifetime — at startup, for reconciliation.

## Write by piggybacking, not by fresh plumbing

The mirror's write path should be **attached to the emit points that already
exist**, not built as a parallel persistence layer with its own call sites.
Every fleet event worth mirroring is already flowing through one or two
chokepoints: the registry's transition door (every state change passes it)
and the event fan-out that notifies views. Hook the mirror there and it is
structurally impossible for a state change to be visible to consumers but
missing from the mirror — the two share a source. Build the mirror as a
separate layer that each writer is supposed to also call, and the mirror's
completeness becomes a discipline, which means it decays; the divergence
surfaces only at the worst moment, the restart that needed the mirror to be
right ([the gate must see its target](../../_laws.md#gate-sees-target) — a
recovery that reads a mirror maintained on a parallel path is recovering a
proxy, and the restart is exactly when proxy and truth part ways).

Mirror-write rules of thumb:

- **Terminal states must not be lossy.** Transitions into exited, failed, or
  lost — and into and out of hibernated — are the mirror's reason to exist;
  they are flushed durably at transition time, not batched on a timer. A
  batched mirror that loses the last thirty seconds turns every crash into a
  small amnesia about precisely the sessions that were changing.
- **High-frequency fields may be lazy.** Last-heard-from advances on every
  output byte; mirroring every advance is waste. Coarsen it (mirror on state
  change plus a periodic touch), and let startup reconciliation absorb the
  slack — the sweeper re-derives liveness anyway.
- **The mirror stores identity, not handles.** Process ids, stream handles,
  and terminal attachments are process-lifetime facts; the mirror records
  them as *claims to verify*, never as capabilities to reuse blindly
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse): the
  session's minted identity is the durable key; everything operating-system
  flavored is a re-checkable annotation).

## Startup: reconcile before you serve

Orchestrator startup is a designed phase with a fixed order — load, verify,
adopt or declare, then open for business. Serving dispatch requests from an
unreconciled registry double-books write scopes and concurrency slots against
sessions that may still be alive.

1. **Load the mirror.** Every entry that was non-terminal at last write is
   now a *claim*, not a fact: "there was a working session with this
   identity, this process, this write scope."
2. **Verify each claim against reality.** Does the recorded process exist,
   and is it corroborably the same process (identifier reuse again)? For
   stream-attached sessions, can the stream be found or re-opened? Each
   verification has three honest outcomes: **alive → adopt** (re-enter the
   registry as live, re-attach the lifecycle sensors, resume slot
   accounting); **gone → declare** (the session died while unwatched — it
   becomes lost, or is graduated through late-result recovery if its output
   can still be harvested); **ambiguous → quarantine** (a process that might
   be the session but cannot be corroborated is not adopted; it is flagged
   for the orphan policy).
3. **Sweep for ghosts in both directions.** Mirror entries with no living
   counterpart are the common ghost; the rarer and nastier one is the
   inverse — a fleet-looking process with no mirror entry, spawned in the
   gap between process start and first mirror write. The orphan scan owns
   these (see [lifecycle-signals](lifecycle-signals.md)).
4. **Only then admit new work.** Slots and write scopes are computed from
   the reconciled registry, so nothing new can collide with an adopted
   survivor.

Hibernated entries pass through reconciliation untouched — no process is
expected, so there is nothing to verify beyond the integrity of the stored
context they will need at wake (see
[hibernation-and-resume](hibernation-and-resume.md)).

## Recovery honesty

Reconciliation is an inference engine, and its output vocabulary must keep
inference distinct from report
([failure ≠ empty success](../../_laws.md#failure-not-empty-success)):

- A session adopted alive is *adopted*, and its lineage says so — later
  debugging of that session must know it crossed an orchestrator restart.
- A session declared dead at recovery is *lost-at-recovery*, distinguishable
  from lost-by-sweep and from self-reported failure. These three populations
  have different root causes (orchestrator downtime, signal delivery, the
  session's own work) and only the labels keep them separable.
- **Recovery that finds nothing to recover says so explicitly.** An empty
  mirror and an unreadable mirror are different events; treating a corrupt
  or missing mirror as "fresh start, zero sessions" silently discards the
  fleet. Assert the instrument, then report the result.

## What the mirror is not

The mirror is a **crash-recovery artifact, not a query surface**. Dashboards,
dispatchers, and sweepers read the in-memory registry; the moment consumers
read the mirror directly, its write cadence becomes a user-facing freshness
contract and the lazy-write latitude above disappears. One reader, one
moment: the next startup.
