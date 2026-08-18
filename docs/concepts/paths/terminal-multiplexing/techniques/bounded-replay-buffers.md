---
layer: technique
subject: terminal-multiplexing
technique: bounded-replay-buffers
status: forged
laws: [count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Bounded replay buffers

Every live session keeps a bounded tail of its own output in the backend,
regardless of whether anyone is watching. On attach, the tail is replayed
into a fresh emulator before the live flow is spliced in. This single
mechanism is what licenses everything else in the subject: detach can tear
down the emulator *because* the ring holds the context needed to rebuild
one, and the budget can evict *because* eviction costs the user a replay,
not their history.

The general discipline — dual budgets, head eviction, truncation honesty,
the ring is not the system of record — is owned by
[streaming-output's buffering-and-backpressure](../../streaming-output/techniques/buffering-and-backpressure.md).
This technique does not restate it; it owns what is terminal-shaped about
the ring, the replay, and the splice.

## The ring lives on the backend, sized in bytes

Two placement rules, both consequences of the terminal setting:

- **Backend side of the boundary.** The ring sits with the pseudo-terminal,
  not with any view layer, because it must fill while no view exists — that
  is its entire purpose — and because producing into a buffer on the
  producer's side means bytes cross the expensive boundary only for
  consumers that exist (a replay on attach, increments while subscribed).
- **Bytes, not lines or entries.** Terminal output has no natural record:
  full-screen programs emit cursor movements and partial-line repaints, and
  a "line"-bounded ring is defeated by a program that never emits a newline.
  The budget is a byte count chosen to reconstruct several screens of
  context — enough that a returning user re-orients without scrolling to an
  edge, small enough that the roster's worst case (every session's ring
  full, simultaneously) is a number someone has actually multiplied out.
  The per-session bound times N **is** the product's memory promise for
  backgrounded work; leaving either factor implicit is how the promise gets
  broken politely.

## Replay is a byte-faithful transcript, not a text log

What the ring stores is the raw output stream, control codes included — not
a cleaned-up text rendering of it. The emulator that receives the replay is
the same machine that would have received the live flow, and it needs the
same input: colors, cursor addressing, alternate-screen switches. A ring
that stores "the text" replays a terminal with its formatting amputated and
its full-screen programs scrambled.

The known cost of byte-faithfulness: a ring can begin mid-escape-sequence
after head eviction, and a replayed alternate-screen switch without its
partner can leave the emulator in the wrong screen. The standard mitigation
is cheap and honest — drop the possibly truncated leading fragment, or lean
on the emulator's documented tolerance for a torn sequence at the start of
a write — and accept that the first replayed screen may repaint imperfectly
until the next full redraw from the child. What is not acceptable is
parsing and rewriting history to "fix" it: the transcript is evidence, and
an editor of evidence needs correctness proofs nobody has.

## The splice: replay, then live, no gap, no double

The requirement is exact: everything in the snapshot is rendered once,
everything after the snapshot is delivered once, and nothing falls between.
Two mechanisms meet it; both are load-bearing enough to name:

- **Position-keyed.** The backend maintains a monotonic byte offset per
  session; attach snapshots (contents + end position), replays, then
  subscribes *from that position*. The offset arbitrates the boundary, so
  producer and consumer need no other agreement.
- **Atomic snapshot-on-subscribe, with a hold gate.** The subscribe call
  itself returns the snapshot, with "mark subscribed" and "read the ring"
  performed under one lock at the source — nothing can be emitted live that
  is not also in the snapshot, and nothing in the snapshot will be emitted
  live. The consumer's remaining duty is ordering: live output can arrive
  *while the snapshot is still in flight*, so it is held in a queue, the
  emulator is reset, the snapshot is written, then the queue flushes. A
  generation counter on the attach cancels a stale snapshot when the user
  flips away and back faster than the round trip resolves.

What both mechanisms refuse is the two dishonest splices. Keying by time
("ignore anything older than the snapshot's timestamp") double-delivers or
drops at the boundary whenever producer and consumer clocks disagree —
which, across a process boundary, is always. And no key at all ("replay,
then subscribe, hope nothing happened in between") is correct exactly when
the session is idle, i.e. never when it matters.

## The ring serves readers besides the terminal

Once every session's recent output lives in a bounded backend ring, the
ring becomes the substrate for **reading without rendering** — consumers
that need to know what a session is showing without paying for a terminal:

- **Glanceable previews.** A roster of unwatched sessions can show each
  one's last few lines by cooking the ring's tail into plain text —
  stripping control sequences, honoring clears — at a low poll rate. A
  cheap change cursor (a revision counter bumped per append) lets pollers
  skip sessions whose rings have not moved, so an idle fleet costs nothing
  to glance at.
- **A programmatic screen model.** Automation that must answer "what is on
  this session's screen" (to decide whether it is waiting for input, or to
  drive it — see keystroke-injection) can maintain a headless screen model
  fed from the ring: built lazily on first read, then fed incrementally per
  append, so steady-state reads cost the screen, not a re-parse of the
  whole ring.

Both are existence-column costs by construction, which is the point: they
give unwatched sessions a face and a readable screen while the attention
column stays reserved for terminals someone is actually in.

## Truncation is disclosed at the seam the user can see

When the ring has evicted, the replayed view begins mid-history, and the
surface says so — a marker at the top of the replayed content stating that
earlier output was dropped and how much
([count-carries-predicate](../../_laws.md#count-carries-predicate): the
number carries "bytes of earliest output, evicted to bound memory", not a
bare figure). The alternative — replay that silently starts wherever the
ring happens to start — teaches users that backgrounded terminals lose
output *unpredictably*, which is worse than the truth that they lose output
*beyond a stated tail*.

If the product needs more than a tail — full transcripts for audit or
harvest — that is a durable record written at wire speed alongside the
ring, per the neighbor technique's "the live buffer is not the system of
record". The ring is never scraped at session end and called the
transcript.

## Rings name their reaper

Per-session rings are the textbook shape of the registry leak
([creation-names-reaper](../../_laws.md#creation-names-reaper)): created on
session start, keyed by session identity, individually bounded — and
collectively unbounded if nothing removes entries. The reapers are named at
creation: session death schedules the ring's release after a bounded
post-mortem window (long enough for the "why did it die" read, not
indefinite), and roster removal releases it immediately. A multiplexer that
keeps every dead session's ring "because they're small" has moved its
memory ceiling from per-session×N to per-session×all-of-history.
