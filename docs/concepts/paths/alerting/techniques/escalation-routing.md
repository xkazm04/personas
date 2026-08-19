---
layer: technique
subject: alerting
technique: escalation-routing
status: forged
laws:
  - one-authority-per-vocabulary
shared_with: []
---

# Escalation and routing

Not every fire deserves the same interruption. A channel where everything
arrives at maximum volume is a channel with one effective severity —
"loud" — and loud-only channels get muted whole. Routing is the discipline
that spends attention proportionally: severity decides **reach** (which
surfaces, how interruptive, how persistent), escalation decides what
happens when the first spend of attention buys nothing, and quiet hours
decide when delivery defers to human rhythm. Throughout, one boundary
holds: this technique decides *what reaches which channel and when*; how a
channel presents an interruption — stacking, persistence, accessibility,
takeover to the operating system — is the
[toasts & notifications](../../toasts-notifications/toasts-notifications.md)
subject's whole business.

## Severity is a closed vocabulary with operational meaning

The severity set is small (three or four levels is the ceiling of human
discrimination), defined **once**, and consumed everywhere — the rule
editor's picker, the evaluator's fire record, the router's reach table,
every badge that renders it
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Two hand-maintained copies of the severity set will drift the day someone
adds a level, and a fire whose severity one component cannot interpret
gets routed by accident.

Each level is defined by its **consequence**, not by an adjective. A
workable ladder:

- **info** — recorded, visible in history and on the alert surface; never
  interrupts. Exists so authors have somewhere to put "I want a record,
  not a reaction".
- **warning** — appears on ambient surfaces (badges, panels); interrupts
  softly if at all; waits for the human to arrive.
- **critical** — interrupts now, on the surfaces designated for
  interruption; persists until seen; eligible for escalation and
  quiet-hours penetration *if configured*.

If two severities have the same reach in every situation, they are one
severity wearing two names — merge them. The definition of each level's
reach is data (a routing table), not scattered conditionals, so that "what
does critical actually do?" has one place to be answered and changed.

## Escalation: the reaction to silence

Escalation is routing's second move: **when attention was spent and
nothing happened, spend more**. The trigger is an alert aging past a bound
without acknowledgment — the lifecycle's unowned-and-firing state is
exactly what makes this computable. Escalation then widens reach along a
declared ladder: a louder surface, a more intrusive channel, a broader
audience. Three rules keep it honest:

- The ladder is finite and declared per severity; escalation that invents
  new channels at runtime is spam with initiative.
- Acknowledgment halts it — escalation exists to find an owner, and stops
  the moment one exists.
- Each escalation step is written to the episode's history like any other
  transition; "who was nagged, when, on which channel" is auditable.

De-escalation is not part of the ladder: resolution ends the episode, and
recovery notices travel at *reduced* reach (see
[flap-control](flap-control.md)) — good news never needs to interrupt.

## Quiet hours mute delivery, never measurement

Humans configure windows where interruption is unwelcome. The essential
invariant: **quiet hours are a delivery-layer filter, not an
evaluation-layer switch.** Rules evaluate all night; fires are recorded
all night; cooldowns and lifecycles advance all night. What changes is
only the reach of delivery — interruptions are held, softened, or
deferred to a morning digest. Implemented instead as "pause alerting at
night", the system cannot tell a quiet night from a blind one, and the
morning operator reads "no alerts" as "no problems" — the most expensive
misreading available.

Deferred delivery then owes a **catch-up**: alerts that fired during the
window are presented when it ends, coalesced ("4 alerts overnight, 1
still firing") rather than replayed as a morning storm of stale
interruptions. Severity interacts here by declared policy: a level may be
configured to penetrate quiet hours ("wake me for critical"), and that
choice belongs to the human being woken — it is preference data, never a
code constant.

## Decision rules

- The routing table (severity × situation → reach) is data with one owner;
  changing what "warning" does must be an edit, not a refactor.
- Per-rule channel overrides are allowed but recorded as overrides — the
  audit question "why did this arrive here?" resolves to either the table
  or a named exception.
- Escalation bounds (how long unacknowledged before step N) live with the
  severity definition, and the clock starts at fire time, not delivery
  time — a deferred delivery does not delay the owner-search.
- Every routing decision is reconstructible from the fire record plus the
  table's state at fire time; "the router decided" is never the end of an
  audit trail.
