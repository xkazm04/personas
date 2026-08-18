---
layer: technique
subject: fleet-orchestration
technique: lifecycle-signals
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Lifecycle signals

A fleet registry is only as truthful as the mechanism that moves its entries
between states. This technique is that mechanism: a **primary channel** of
signals the sessions emit themselves, backed by a **staleness sweeper** that
assumes the primary channel drops things — because it does. Neither tier is
optional. Signals without a sweeper accumulate ghosts; a sweeper without
signals reduces the fleet's state model to "process exists or not," throwing
away everything interesting (waiting on input, idle with context, finished
with results).

## Tier one: sessions report themselves

The best lifecycle information is emitted at the source, at the moment of
transition, carrying intent:

- **Runtime lifecycle hooks** — the session's own runtime announcing "I have
  started," "I am waiting for permission," "I have finished this task." These
  are the gold standard: prompt, unambiguous, and semantically rich in
  exactly the dimension a process table is blind to.
- **Structured output markers** — for sessions whose medium is a stream of
  structured events, lifecycle facts ride the same stream as the work
  product. The orchestrator's stream reader doubles as a lifecycle sensor.
- **Activity itself** — any observed output, structured or not, is evidence
  of life. Even when a session's medium is an opaque interactive terminal,
  bytes flowing is a heartbeat, and the registry's last-heard-from field
  should advance on every one of them.

**Keep activity signals separate by provenance, because they mean different
things.** A mature fleet tracks at least three independent recency facts per
session, and collapses them into one "last activity" timestamp only for
display: *when a control-channel signal last arrived* (a hook, a lifecycle
event), *when raw output last flowed* (bytes on the stream or terminal), and
*when the session's durable work product last actually grew* (its transcript,
its artifact, its log). They rank differently as evidence. Artifact growth is
the strongest "actually working" signal — it cannot be faked by a repaint.
Raw output is the weakest: interactive runtimes redraw their status displays
continuously, so a hung process can animate forever; conversely, *total*
output silence from a runtime known to repaint is a fast, confident
frozen-process verdict long before the general staleness budget expires. A
sweeper that sees only one merged timestamp can express none of these
distinctions, and every one of them changes the verdict.

Two disciplines keep tier one honest:

1. **Signals are observations, not commands.** A signal handler never writes
   a status; it reports the observation through the registry's transition
   door, which knows the session's current state and decides. This is what
   keeps a late, duplicated, or out-of-order signal from corrupting the
   machine — the door arbitrates; handlers just deliver
   ([one authority](../../_laws.md#one-authority-per-vocabulary) over the
   vocabulary, one door over the transitions).
2. **Signal vocabulary maps onto registry vocabulary, totally.** Every
   signal kind the sessions can emit has a defined meaning in the registry's
   state machine — including "no meaning, ignore." An unmapped signal kind
   is a state transition silently not happening, which is the hardest class
   of fleet bug to see because nothing errors.

## Tier two: the sweeper assumes tier one lied

Every delivery path in tier one has a failure mode that produces *silence*,
not an error: the process dies before its exit hook runs; the stream closes
mid-event; the machine sleeps and the wake-up delivers nothing. Silence is
exactly what a signal-driven system cannot see — so the second tier exists to
convert silence into information
([failure ≠ empty success](../../_laws.md#failure-not-empty-success)).

The sweeper is a recurring supervised loop (per
[background-jobs](../../background-jobs/background-jobs.md) — it registers,
it is isolated, it has its own health signal) that periodically walks the
registry and checks each live-claiming entry against reality:

- **Process check.** The entry claims a process; does the operating system
  agree? Check the actual process, not a cached handle — a gate that
  consults a proxy passes exactly when the proxy has diverged
  ([gate-sees-target](../../_laws.md#gate-sees-target)). Beware identifier
  reuse: a process id alone can be recycled onto an unrelated process, so
  the check should corroborate (start time, command identity) before
  trusting a match.
- **Staleness check.** The entry claims activity; how old is
  last-heard-from? Each state carries its own staleness budget — a working
  session should be heard from on the order of its output cadence, an
  awaiting-input session may be legitimately silent for hours, a hibernated
  session is *supposed* to be silent and is exempt. One global timeout
  produces either false alarms on the patient states or blindness on the
  active ones. **And budgets are calibrated per workload, not only per
  state**: a session whose normal working mode includes long, legitimately
  silent stretches (a heavy build step, a large batch operation) will be
  serially declared frozen by a budget tuned for conversational cadence —
  and a healthy session repeatedly wearing a "safe to kill" label is how
  fleets kill healthy sessions. Identify the silent-workload classes at
  dispatch and widen their budgets deliberately, with the multiplier written
  down.
- **Orphan scan.** The inverse direction, run at least at startup and
  ideally periodically: processes that look like fleet sessions but have no
  registry entry. Orphans arise when the orchestrator dies between spawning
  and recording, or when the durable mirror lost a beat. An orphan is
  adopted (matched to a mirror record and re-entered) or terminated —
  deliberately, with a record — never left running unaccounted.

The sweeper writes its findings through the same transition door as the
signals, with its own honest vocabulary: what it declares is **lost**, never
**exited** — an inference and a report are different facts, and downstream
debugging depends on the difference surviving.

## Keeping the tiers in agreement

The two tiers watch the same sessions through different instruments, so they
will occasionally disagree — the design question is where the disagreement is
resolved. Standard answers:

- **The door arbitrates, with defined precedence.** A self-reported terminal
  state beats a sweeper inference (the session knew; the sweeper guessed).
  A sweeper's "process is gone" beats any *non-terminal* self-report,
  however recent — claims of working do not survive the absence of a
  worker.
- **Corrections are recorded, not overwritten.** When a late signal upgrades
  lost to exited, the entry keeps both facts. A fleet whose sweep declares
  sessions lost minutes before their exit signals arrive has a delivery
  latency problem, and only the correction trail makes that pattern visible
  enough to fix.
- **Grace periods live at the boundary between tiers.** The sweeper never
  declares lost inside the window where a signal could still plausibly be in
  flight; several missed expected-heartbeats, not one, is the threshold —
  a single delayed write must not trigger a false death.
- **Evidence can overturn a standing signal — in both directions.** Some
  runtimes emit their "waiting for input" signal spuriously, during long
  tool waits or latency gaps, so a session can be marked waiting while it is
  demonstrably still producing. The sweep resolves this with evidence: on
  first seeing a session in the waiting state it snapshots the size of the
  session's work product, and if a later pass finds growth *past that
  baseline*, the wait was spurious and the session is revived to working.
  The baseline-at-first-sweep timing matters — snapshotting at the signal
  instead would race the output flush that legitimately accompanies a real
  question, and revive genuinely waiting sessions. The general form: a
  state is a claim; the sweeper holds claims up against physical evidence
  and lets the evidence win, through the same arbitrating door as
  everything else.
