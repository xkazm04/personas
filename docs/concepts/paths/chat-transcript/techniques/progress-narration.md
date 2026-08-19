---
layer: technique
subject: chat-transcript
technique: progress-narration
status: forged
laws:
  - count-carries-predicate
  - derivation-names-recomputation
shared_with: []
evidence:
  - src/features/plugins/companion/NarrationThread.tsx         # live log capped at 5 rows with "+N earlier"; settled trail "What I did — 7 steps · 48s", expandable
  - src/features/plugins/companion/narrationTimeline.ts        # the durable step record the trail is recomputed from
  - src/features/plugins/companion/chat/AthenaChatStreamingTurn.tsx  # ONE progress surface on purpose — four competing narrations consolidated
---

# Progress narration

While a machine turn works, the transcript answers the user's standing
question — *is it doing anything, and what?* — with a narration: a small live
thread inside the turn listing current and recent activity. When the turn
settles, that narration **collapses into a compact trail**, because the two
moments have opposite needs: live, process detail is the product; settled,
the answer is the product and process detail is clutter between the user and
their conversation.

## The live thread

The live narration is a bounded, append-mostly list of human-readable
activity items — consulting a source, invoking a capability, composing —
rendered inside the pending/streaming turn. Its honesty rules are inherited
from streaming-output and apply with full force:

- Each item is **derived from observed events**, not scripted theater. The
  derivation discipline (event shapes → phase, dwell smoothing, stall
  degradation) is owned by streaming-output's
  [phase-derivation](../../streaming-output/techniques/phase-derivation.md);
  narration is that technique's transcript-facing costume.
- **Silence degrades the claim.** An item that says "reading the report" two
  minutes after the last event is a lie of omission; past a threshold the
  narration says so ("still working — no activity for a while").
- **The thread is bounded.** Long-running turns produce hundreds of steps;
  the live view shows the recent tail with a running count, not an unbounded
  scroll of its own inside the transcript's scroll.

Narration items are *about* structured events but are not the events'
canonical rendering — a tool invocation that merits a durable, expandable
card is an [inline structured row](inline-structured-rows.md); the narration
line is its ephemeral announcement. The two must not compete: if a step is
promoted to a full row, the narration does not duplicate it at equal weight.

## The collapse

At settlement the thread folds to a single trail line: step count, elapsed
time, the few notable actions — expandable to the full step record. The rules
that keep the collapse honest:

- **Collapse is presentation, not deletion.** The full step record survives
  settlement and is recoverable by expansion. What is discarded is only the
  live-view state (tail windows, in-flight animation) — never the record.
- **The summary is recomputable from the record**, per
  [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation).
  "14 steps · 3 sources · 2 capabilities" must be re-derivable by counting
  the retained steps; a summary scraped from whatever the live view happened
  to show last drifts from the record it summarizes and there is no arbiter.
- **Counts carry predicates**, per
  [count-carries-predicate](../../_laws.md#count-carries-predicate). "14
  steps" where retention truncated to the last 50 of 400 is a false count;
  either the count reflects the true total (tracked even when detail is
  shed) or the trail says it is partial.
- **Failure keeps its detail.** A turn that settles failed collapses less: the
  trail leads with the failing step, expanded or one interaction away,
  because for a failed turn the process *is* the answer the user needs.

## What narration is not

- **Not a second transcript.** The trail is one line of the turn; it does not
  interleave narration rows between turns or persist live-style step rows at
  full weight into the settled view.
- **Not a progress bar.** Machine turns have no honest percentage; narration
  states what is happening, elapsed time, and step counts — quantities that
  are true — rather than a completion fraction that is invented.
- **Not replayed.** Re-opening a settled conversation renders trails settled;
  animating old narration as if live re-runs theater over history and
  confuses the recency signal the live thread exists to give.
