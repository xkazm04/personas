---
layer: technique
subject: toasts-notifications
technique: queue-discipline
status: forged
laws: [identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# Queue discipline

Toasts arrive whenever the system has news, which means they arrive in
bursts: a batch job completing item by item, a failure storm from one dead
dependency, three subsystems reacting to the same reconnect. An undesigned
transient layer renders whatever shows up and lets the screen sort it out.
A designed one is a **queue with admission, display, and eviction policy**
— the toast a user sees is the *output* of that policy, not the direct echo
of an event.

## Identity first

Every message entering the queue gets a durable identity at creation
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)), and a
separate **semantic key** — kind plus subject ("connection-lost:
provider-X"), normalized so volatile fragments (record ids in prose,
counts, timestamps) do not make every repeat look novel.

- The **identity** keys rendering, animation, timers, and dismissal — never
  the message's position in the queue, which changes every time a neighbor
  leaves. Position-keyed toasts produce the classic defect family: the
  wrong toast dismissing, an exit animation replaying on the survivor, a
  timer inherited by whoever slid into the slot.
- The **semantic key** drives dedup and coalescing (below). Two messages
  may share a semantic key and still be distinct queue entries in time;
  they never share identity.

## Display policy

- **Max visible.** A small fixed number of toasts on screen — the rest
  wait in the queue. The number is a design constant, not "however many
  arrived"; past a handful, additional simultaneous toasts subtract
  comprehension rather than add information.
- **Dwell per severity.** Auto-dismissal time comes from the severity
  mapping table, scaled by reading time — a two-line error needs longer
  than a one-word success. Dwell applies only to awareness-class messages;
  action-required messages do not auto-dismiss at all (the golden path's
  actionability rule).
- **Attention pauses the clock.** Hover or focus on a toast suspends its
  timer; leaving resumes it (a fresh reading allowance, not the stale
  remainder — the user who returns is re-reading). Dismissing content the
  user is demonstrably attending to is the one unforgivable dwell bug.
- **Ordering is stable and newest-visible.** New messages must be able to
  appear even while old ones hold the screen — a full window plus a strict
  FIFO would hide a fresh critical behind three stale successes. Either
  reserve headroom for higher severities or allow severity to preempt:
  eviction below (see overflow) creates the room.

## Dedup and coalescing

A repeating failure — the poll that dies every ten seconds — must not earn
a toast per occurrence. Repetition is *new information exactly once*: the
transition from "happened" to "still happening".

- **Same semantic key while a toast for it is live** → coalesce: bump a
  visible count on the existing toast ("still failing — 14×"), optionally
  refresh its dwell. Never spawn a sibling.
- **Same semantic key shortly after dismissal** → a cooldown window
  decides whether the repeat re-toasts or only increments the ledger
  record. The window is severity-dependent: errors may re-surface after
  minutes; successes never need to.
- Coalescing is **counted, not silent** — a suppressed repeat still
  increments the visible count and still reaches the durable record. Dedup
  that discards is under-delivery wearing tidiness as a disguise.

## Overflow policy

When arrivals outrun the display window plus queue tolerance, the system
degrades *deliberately*, in order:

1. **Coalesce harder** — collapse same-kind entries across subjects
   ("3 jobs failed") before dropping anything.
2. **Summarize the tail** — one synthetic toast ("N more notifications")
   that opens the ledger, replacing the queue's tail rather than racing
   through it. Draining a 40-deep backlog at normal dwell shows the user
   old news for minutes; nobody wants a replay of the storm.
3. **Shed lowest first** — if shedding is unavoidable, drop
   awareness-class low severities, oldest first, and *route every shed
   message to the ledger*. The screen may miss it; the record may not.

## Timers are owned resources

Every dwell timer, cooldown window, and animation handle names its reaper
at creation ([creation-names-reaper](../../_laws.md#creation-names-reaper)):
dismissal cancels the dwell timer, teardown of the transient layer cancels
everything outstanding, and a timer callback validates that its toast
*identity* is still live before acting. The resurrection bug — a message
reappearing or a fresh toast vanishing early because a stale timer fired
into a reused slot — is always an unowned timer plus position-keyed
identity, and both halves of the fix are in this technique.

## The queue is observable

The queue has state worth exposing to the rest of the system: current
depth, suppression counts, shed counts. At minimum, messages the queue
declined to display must be distinguishable (in the ledger, in telemetry)
from messages never sent — a transient layer that can silently drop is a
delivery system whose failure mode is indistinguishable from success.
