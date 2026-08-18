---
layer: technique
subject: triage-queues
technique: focus-mode
status: forged
laws:
  - creation-names-reaper
  - failure-not-empty-success
shared_with: []
---

# Focus mode

A list presentation is right for scanning a queue; it is wrong for
*clearing* one. When the operator commits to working the queue down, the
strongest presentation is one item at a time — a deck: the current item
fills the surface with full judgment context, the verdict set sits on
single keys or single gestures, and a verdict advances to the next item
automatically. The design goal is a sustained rhythm of read → decide →
verdict measured in seconds per item, with zero navigation cost between
items. Everything in this technique protects that rhythm from the three
things that break it: ambiguity about what a verdict will hit, a deck that
wedges, and a skip that becomes a hiding place.

## The deck contract

- **One current item**, defined as the first remaining item under the
  queue's ordering — a derived value, never a stored index (the cursor
  argument in
  [queue-ordering-and-identity](queue-ordering-and-identity.md)).
- **Full context in place.** The deck shows enough to decide — summary,
  origin, severity, the evidence that raised the item — because any "open
  in another surface to understand" step collapses the rhythm to the speed
  of navigation. Items that *cannot* carry decision context are a signal
  the actionable predicate is failing upstream, not a reason to make the
  deck heavier.
- **Verdicts on keys and gestures.** Each admissible verdict binds to one
  key (and, where the input surface supports it, one directional gesture).
  Bindings stay constant across items; a verdict the current item does not
  admit is disabled, not rebound.

## The verdict targets what the operator saw

Keyboard rhythm creates a race the list presentation never has: the queue
mutates (an arrival, a background refresh) at the same moment the operator
presses a verdict key. If the handler resolves "current item" *after* the
mutation, the verdict lands on an item the operator never read. The rule:
**a verdict binds to the identity of the item that was displayed when the
input occurred**, not to whatever is current when the handler runs. Capture
the identity at render, pass it through the input path, and if it no longer
matches the head of the queue, the verdict still applies to the captured
identity — or is dropped with a visible notice — never transferred to the
new head.

## The in-flight lock and its watchdog

While a verdict's write-back is unconfirmed, the deck locks: further
verdict input is ignored (disarming double-submission at the source) and
the surface shows the in-flight state. A lock, once created, must name what
releases it ([creation-names-reaper](../../_laws.md#creation-names-reaper)) —
and confirmation-or-error is not a complete answer, because the failure
mode that actually strands operators is the write that neither confirms
nor errors: a hung request, a lost response, a backend that went away
mid-call. Every lock therefore carries a **watchdog**: a bounded timer that
force-releases the deck, surfaces "verdict unconfirmed" for the affected
item, and returns the item to the remaining set. A wedged deck is the
worst outcome available to this technique — it converts the operator's
highest-throughput mode into a frozen screen — and silence about *why* it
unfroze would compound it
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## Bounded skip: deferral sorts last, never hides

"Not this one right now" is a legitimate verdict-free move, and an
unbounded version of it destroys the queue. The semantics that survive:

- **Skip defers, never removes.** A skipped item stays in the remaining
  set and re-sorts to the end of the ordering. It remains in every count.
  A skip that hides an item creates a shadow queue of unhandled work that
  no surface reports — the exact condition the subject exists to abolish.
- **Skip is bounded, because an unbounded skip means the deck cannot
  terminate.** Skip the last remaining item and it is instantly the last
  remaining item again, forever. The workable bound: an item may be
  deferred a small fixed number of times — the first skip is "not now,
  show me the rest", and re-offering it after the queue drains is the
  point of sorts-last; a repeat skip with the same queue in front of the
  operator is them saying it again, and taking them at their word is what
  lets the deck finish. An item skipped to exhaustion *stands down for
  the session* — no longer dealt, but reported as a visible deferred
  count and still part of the session's totals. "Seen and not decided" is
  an outcome, not an absence.
- **Skips are session-scoped by default.** A fresh session re-presents
  deferred items in policy order. Durable snoozing is a different feature
  with a timestamp and a wake condition — if offered, it is an explicit
  verdict written back like any other, not an accumulating client-side
  memory of avoidance.

## Verdicts that need a reason

Some verdicts (typically rejections) carry a required "why". Where the
prompt sits depends on how the verdict arrived, and the asymmetry is
deliberate: a *key or button* verdict asks before the item leaves, while
the operator can still see what they are rejecting; a *gesture* verdict has
already happened — the motion is the point of the surface — so the prompt
follows the motion, and resolving it must not re-fire the departure that
already occurred. Either way the reason is part of the verdict's write-back
payload, not a separate afterthought that can be lost independently.

## The exit

The deck's terminal state is the queue's healthiest one: empty. Reaching it
deserves an explicit completion state — items handled, deferrals remaining
(if any), a route back to the scanning view — because the difference
between "you finished" and "the deck broke" must never be left for the
operator to infer from a blank surface. Two honesty rules govern the
readout. The progress fraction's denominator is *decided plus
still-pending*, never the raw source count — a live queue's raw count
shrinks as other actors resolve items, and a denominator that shrinks under
a growing numerator eventually displays progress greater than its total.
And the cleared ending must respect the capped-source rule from
[source-normalization](source-normalization.md): "deck cleared" and
"nothing in the world is waiting on you" are different sentences whenever
any source failed or returned a full page.
