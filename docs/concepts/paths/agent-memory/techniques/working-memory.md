---
layer: technique
subject: agent-memory
technique: working-memory
status: forged
laws: [creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Working memory

Working memory is the operative state of the task in flight: the goal as
currently understood, the constraints discovered so far, the decisions already
made and their reasons, the open threads not yet closed. It is the layer that
makes an agent coherent *within* a session — able to act at step forty on
something it learned at step three without re-deriving it — and it is defined
as much by what it is not: it is not a draft of long-term memory, and nothing
in it survives the session by default.

## Synthesized, not accumulated

The defining discipline. An append-only log of everything seen this session is
not working memory — it is a transcript growing inside the context, and it
fails the same way transcripts always fail: the signal from step three is
buried under the noise of steps four through thirty-nine, and the total grows
until it evicts the very things it was keeping.

Working memory is a **rolling synthesis**: a bounded structure that is
*rewritten*, not appended to, as understanding changes. When a constraint is
discovered, it replaces the assumption it corrects — it does not sit after it
in a list, leaving the reader to notice the contradiction. When a sub-task
completes, its play-by-play collapses into its outcome. The synthesis is
performed at meaningful moments (a decision made, a phase completed, a
surprise encountered), not on a clock; clock-driven summarization compresses
whatever happens to be there, meaning-driven synthesis compresses what just
became compressible.

Two properties fall out:

- **Bounded slots, not bounded truncation.** The structure has named regions —
  goal, constraints, decisions, open threads — each with a size discipline.
  When a region is full, the *least operative* item is evicted by judgment.
  Truncating from the top (the oldest) is the transcript failure again:
  oldest is where the goal statement lives.
- **The current version is the only version.** Working memory has no history;
  the episodic layer owns history. Keeping superseded working states "just in
  case" recreates the append-only log one level up.

## Scope and identity

Working memory is keyed to the unit of work it serves — a session, a task, a
run — and that key is minted identity, not position. If sessions can be
resumed, suspended, or run concurrently, "the current working memory" is a
bug: two concurrent tasks sharing one operative state will interleave their
constraints and decisions into a plausible-looking corruption. One unit of
work, one working store, addressed by the work's identity — which must
survive suspension and resume, per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse).

Whether working memory survives a *process* restart is a separate decision
from whether it survives the *session*: a resumable session implies working
memory that persists across restarts (else resume is amnesia wearing the old
session's id), while a session that ends at process exit implies working
memory that owes nobody durability. Decide which contract the unit of work
has, and make the store match it.

## Expiry: working memory names its reaper

Working memory is created per unit of work, so per
[creation-names-reaper](../../_laws.md#creation-names-reaper) its destruction
is declared at creation: it dies when the work ends — completion, abort, or a
staleness horizon for work that is abandoned rather than closed. The
staleness horizon matters more than it looks: long-lived agents accumulate
suspended tasks, and a working store with no time-to-live becomes a museum of
half-finished operative states that some future resume will mistake for
current.

Expiry is deletion, not archival. The episodic layer captures what the work
*was* at its boundaries; the working layer's job ends when the work does.
Keeping expired working memory around "for context" gives future recall a
supply of stale operative detail with the formatting of current state — the
most confusable kind of wrong.

## Promotion is explicit or it is nothing

The one legitimate exit from working memory, other than deletion, is
**promotion**: a fact learned mid-task that deserves to outlive the task is
handed to the episodic layer as part of a captured episode — at which point
it enters the normal pipeline (capture → consolidation → belief) and earns
durability through the same judgment as everything else.

What promotion is *not*: a direct write from working memory into the
consolidated store. That shortcut feels efficient and quietly creates a
second writer to the belief layer — one that bypasses the distillation
judgment, carries no episode-grade provenance, and stamps in-flight
impressions with the authority of settled knowledge. In-session confidence
is exactly the wrong signal for durability: the moment a thing feels most
important is the moment its half-life is least knowable.

## What the layer owes its consumers

- **Recency of truth, not of mention.** A consumer reading working memory
  gets the current understanding — the corrected constraint, not the
  original guess plus a correction somewhere later.
- **Decisions with reasons.** "Chose the narrower interface (the wide one
  breaks resumability)" — the reason is what prevents the decision from
  being silently re-litigated at step sixty.
- **Open threads as first-class items.** The cheapest prevention for the
  classic long-task failure — the forgotten sub-task — is a region of the
  structure whose whole job is "not done yet".
- **Honest smallness.** Working memory that fits comfortably inside the
  attention it is given gets *read*; one that sprawls gets skimmed, and a
  skimmed operative state is a coin-flip on every constraint in it.
