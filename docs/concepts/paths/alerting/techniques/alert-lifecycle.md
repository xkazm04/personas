---
layer: technique
subject: alerting
technique: alert-lifecycle
status: forged
laws:
  - identity-survives-reuse
  - creation-names-reaper
shared_with: []
---

# Alert lifecycle

A fire record that only ever says "fired" is a stream, not a system. The
moment humans are expected to *act* on alerts, each alert needs a life:
someone can be working on it, it can be over, and — most valuable of all —
the way it ended can be recorded. The lifecycle is deliberately small;
every state must earn its place by changing either what the system does or
what a human can learn from the record.

## Three states, four endings

**Firing → acknowledged → resolved.** That is the whole spine.

- **Firing** — the condition was detected and the record written. The alert
  is unowned: it renders loud, it counts toward "open alerts", and it is
  eligible for escalation precisely *because* nobody has claimed it.
- **Acknowledged** — a human said "seen, mine". Acknowledgment is an
  ownership claim, not a resolution: the condition may still be true. Its
  effects are social and mechanical at once — the alert quiets (repeat
  notifications and escalation stop; the owner is working), and everyone
  else can see who has it. An unacknowledged critical alert aging past a
  bound is itself a signal the routing layer may escalate on.
- **Resolved** — the episode is over. Resolution carries a **kind**, and
  the kinds are the analytically valuable part:
  - *auto-resolved* — the evaluator observed the condition end (the
    recovery event from [flap-control](flap-control.md) resolves the
    record it corresponds to);
  - *fixed* — a human resolved it after intervening;
  - *dismissed as noise* — a human resolved it while asserting no real
    condition existed;
  - *expired* — a retention or staleness policy closed it unattended.

The kinds are a closed vocabulary, because they are the substrate of the
channel's quality metric: a rule whose resolutions are dominated by
*dismissed as noise* is a rule that is spending attention and returning
nothing — the strongest possible datum for retuning or deleting it. A rule
whose fires are mostly *auto-resolved* within minutes is announcing
self-healing blips nobody needed to hear about, and is asking for a longer
sustain. None of this analysis is possible if resolution is a single
undifferentiated "closed".

## Identity across the episode

One condition episode = one record, from fire through resolution
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). The
record's identity is minted at fire time and carried by everything that
touches the episode: suppressed repeats increment its counter (they do not
create siblings), the acknowledgment attaches to it, the recovery resolves
it. Re-fires *after* resolution are new episodes — linking them ("previous
episode: 2 hours ago") is display sugar over distinct records, not reuse
of the old one. Collapsing repeats into the open episode while separating
distinct episodes is exactly the state-predicate suppression shape
("do not re-fire while an episode is open") described in
[cooldown-and-debounce](../../scheduling/techniques/cooldown-and-debounce.md),
and where the lifecycle exists it beats any time window.

## History is a queryable record, with a reaper

Alert history answers questions long after the fires quiet: *did this rule
fire during Tuesday's incident? how often does this fire monthly? what is
this rule's dismissed-as-noise rate? how long do criticals sit
unacknowledged?* These queries define the storage requirements — the record
keeps rule identity, observed value, threshold at fire time (the rule may
be edited later; the record preserves what was true *then*), all state
transitions with actor and timestamp, and the suppressed-repeat count.

And because history grows without bound by design, it names its reaper at
creation ([creation-names-reaper](../../_laws.md#creation-names-reaper)): a
retention policy — by age, by count, or both — declared where the record is
defined, not discovered when the store bloats. Open episodes are exempt
from age-based reaping (an alert nobody resolved is information, not
garbage) but not from the staleness ending: an episode open past a
generous bound resolves as *expired*, visibly, because an eternally-open
alert is a lie of a different kind.

## The open-alert set is a worked queue

The set of firing + acknowledged alerts is a queue humans work: newest
loud, oldest shameful, ownership visible. That working discipline —
ordering, assignment, aging, bulk operations — is the
[triage-queues](../../triage-queues/triage-queues.md) subject applied to
this record type rather than something alerting re-invents. What alerting
contributes to the queue is honest state: an alert set that mixes
"currently breaching" with "resolved an hour ago but never cleared" makes
the queue unworkable, which is why auto-resolution (the evaluator closing
episodes it observes ending) is a lifecycle feature and not a luxury.

## Decision rules

- Acknowledgment stops repeat-notification and escalation; it never stops
  evaluation — the condition's continued truth is still being measured and
  recorded.
- Only resolution ends an episode; acknowledgment does not silently decay
  into resolution.
- Every transition is written with actor (human or system) and timestamp;
  "who resolved this and when" must never be a mystery.
- The record snapshots the rule's threshold and window at fire time —
  history is what happened, not what today's rule text would have done.
