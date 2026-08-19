---
layer: technique
subject: streaming-output
technique: phase-derivation
status: forged
laws: [one-authority-per-vocabulary, derivation-names-recomputation]
shared_with: []
---

# Phase derivation

The raw event stream is machine-shaped; the user's question is human-shaped:
*what is it doing right now?* Phase derivation answers it — "reasoning",
"writing", "using a tool", "waiting on approval" — by **deriving** a
human-readable phase from the shapes of recent events. The word *deriving*
carries the whole technique: the phase is a pure function of observed
events, recomputable from the event log at any time, never a parallel state
machine with its own memory and therefore its own ways of being wrong
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).

## Derive from shape, don't demand cooperation

The robust source of phase is the **kind of event currently flowing**: a
tool-invocation event means a tool is being used (and usually names which);
reasoning deltas mean thinking; content deltas mean writing; a
waiting-for-input marker means blocked on the user. This reads what the
producer *does*, not what it *says*, so it works with producers that never
heard of the consumer's phase display and it cannot be desynchronized by a
producer that forgets to send a status update.

When the producer *does* emit explicit phase or progress markers, treat them
as one more input shape — gladly used, never required. A derivation that
functions on event shapes alone and is refined by markers degrades
gracefully; a display driven only by markers freezes the moment the producer
skips one.

One shape outranks all labels: **visible output**. Once content is streaming
onto the surface, the content *is* the progress signal, and the phase label
yields — a caption reading "writing" over text the user can watch being
written is redundant at best and, one beat later, stale. Phase labels earn
their place in the gaps: before first output, and during tool use, reasoning,
and waits, when nothing else on the surface moves.

## One phase vocabulary, owned once

The set of phases is a closed vocabulary with a single authoritative
definition, and every surface that shows a phase maps from that one set
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The drift mode is concrete: three surfaces each grow a private
event-to-label mapping; a new event type appears; two get updated; the third
shows its fallback forever — and each surface names the same activity
differently, so the product appears to disagree with itself about what one
run is doing. Derivation logic lives in one place; surfaces choose
presentation (wording, icon, verbosity), never membership.

The vocabulary is deliberately coarse — a handful of phases a user can tell
apart and act on. Per-step granularity ("parsing frame 4,812") is a debug
view, not a phase.

## Smoothing: a phase has a minimum dwell

Raw derivation flaps: a stream interleaving reasoning and writing many times
a second would flap the label into an unreadable shimmer that communicates
only "something is happening fast" — which is less than a stable label
communicates. So derived phases pass through a dwell filter: a newly derived
phase must persist across a minimum window (a few hundred milliseconds)
before the display switches. Two asymmetries keep the filter honest:

- **Terminal and blocking phases skip the dwell.** "Waiting for your
  approval" and "finished" are claims the user acts on; delaying them for
  smoothness delays the user.
- **The dwell delays display, never derivation.** The underlying derived
  value stays current; only the label lags. Anything else that consumes
  phase (logs, records) sees the true sequence.

## Honesty rules

The phase is a live claim about the present, and it decays:

1. **A phase claim has a shelf life.** A specific claim ("using the search
   tool") backed by no events for longer than a threshold degrades to an
   honest generic ("still working — no output for a while"), because the
   evidence for the specific claim has gone stale. A frozen specific phase
   over a silent stream is the display lying by inertia — the streaming
   surface's version of a progress bar stuck at 99%. And long silences are
   the *common* case on real workloads, not a corner: typical runs cross a
   half-minute of silence and then resume, and multi-minute silences that
   resume happen routinely. Which cuts both ways — the stall indication is
   not optional decoration (the median user meets it), and it must not be
   styled as failure (the run it describes usually comes back).
2. **Unknown event shapes derive the generic phase**, not the previous
   phase. Carrying the old label across unrecognized activity asserts a
   continuity nobody verified.
3. **Phase never survives its run.** Attribution scopes derivation: a new
   run starts from the initial phase, and a stale event cannot move the
   current run's label.
4. **Never invent progress.** If the stream carries no basis for "80%
   done", the display shows activity, not percentage. Fabricated
   determinate progress is worse than honest indeterminate progress,
   because users plan around it.

## Phase is presentation, not control flow

The derived phase exists for one consumer: the human. Program logic —
enabling controls, triggering finalization, deciding retries — branches on
**typed events and run state**, never on the derived label. The tell that
this rule is being broken is string comparison against display text buried
in logic. Phase derivation is intentionally lossy (coarse vocabulary, dwell
smoothing, staleness decay); logic built on a lossy projection inherits all
three losses as bugs. Downstream of truth, never upstream.
