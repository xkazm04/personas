---
layer: technique
subject: self-healing
technique: incident-promotion
status: forged
laws:
  - identity-survives-reuse
  - failure-not-empty-success
shared_with: []
---

# Incident promotion

Raw failures are events; incidents are commitments. Promotion is the deliberate
act of converting a *pattern* in the failure stream into a tracked object with an
identity, a lifecycle, and an implied owner — the point where the machine stops
handling and starts reporting. For a self-healing system this is not an optional
garnish: a healer without a promotion path has only two voices, "fixed it" and
silence, and everything it cannot fix disappears into the second one. **A healer
that keeps failing must get louder over time, not quieter.**

## Promotion triggers: patterns, not occurrences

Promoting every failure recreates the failure stream under a new name; the
operator's queue becomes the log, and the queue's authority dies. Promotion fires
on *patterns*:

- **recurrence** — one signature crossing a threshold count within a window; the
  volume proves it is a mode, not an accident;
- **healing futility** — the accounting cell says attempts are high and
  confirmations absent (see effectiveness-accounting); the machine has
  demonstrated, with data, that this case exceeds it;
- **rollback** — a change bad enough to auto-undo promotes unconditionally,
  carrying its full episode (see auto-rollback);
- **severity class** — a small enumerated set of categories (corruption
  indicators, security-adjacent failures, anything tier-3-shaped) promotes on
  first occurrence, because waiting for a pattern in that class is negligence
  with a threshold;
- **budget trips** — the healing layer hitting its own storm caps is itself
  reportable: the maintenance system just declared the weather too bad to work
  in.

Thresholds and windows are data, tuned per deployment; the trigger *set* is the
design.

## Dedup: the incident is keyed by the mode, not the moment

Incident identity derives from the **failure signature** (see
failure-diagnosis) — minted once, stable across process restarts, resorts, and
re-scans (law: identity-survives-reuse; an incident keyed by timestamp or by
scan-batch position duplicates on every restart, and the queue fills with clones
of itself). Recurrences of a signature with an open incident do not create
siblings — they *attach*: occurrence count increments, last-seen advances,
recent-example list rotates. The single number "how many distinct things are
wrong" is the promotion layer's core deliverable, and dedup is what makes it a
number instead of an impression.

Two policies must be stated, not defaulted:

- **Reopen vs new.** A signature recurring after its incident was resolved:
  within a reopen window, reopen (the fix did not hold — and the reopen is
  *evidence against* whatever closed it, feeding back into the accounting);
  beyond it, open fresh with a link to the ancestor. Both branches keep
  history; which branch taken changes what the recurrence *means*.
- **Signature-epoch migration.** When the normalizer version changes, open
  incidents keyed under the old epoch either migrate or are marked
  epoch-orphaned — never silently duplicated under the new keys.

## The incident carries the machine's notebook

The promoted object's value over a raised alert is *accumulated context*. An
incident born from a healing system includes: the diagnosis (signature,
category, confidence), every healing attempt with strategy, outcome, and
timestamps, the do-nothing selections and their reasons, any rollback episode,
and current accounting rates for the relevant cells. The human picking it up
starts where the machine stopped — "tried A twice (unknown, unknown), tried B
once (reverted, regression attached), quarantined B, out of moves" — instead of
re-deriving from the raw stream what the machine already knew. An incident that
says only "signature S exceeded threshold" outsources the machine's own memory
to the responder.

Escalation *routing* belongs to the neighbors: incidents surface through the
operator's queue disciplines ([triage-queues](../../triage-queues/triage-queues.md))
and page through the notification disciplines
([alerting](../../alerting/alerting.md), including its suppression and severity
rules). This technique owns what gets promoted, when, and carrying what — not
who gets woken.

## Lifecycle honesty

Incidents have few states, and the distinctions carry meaning (law:
failure-not-empty-success):

- **resolved** is a claim with an author — a human closed it, or a verification
  predicate confirmed the mode gone; it asserts the problem ended;
- **expired** asserts only that the problem stopped being observed — auto-close
  after sustained silence is legitimate queue hygiene, but it is spelled
  differently from resolved, because "it went away" and "we ended it" diverge
  exactly when the mode is intermittent;
- **acknowledged** stops repeat escalation without claiming anything about the
  problem.

Collapsing expired into resolved poisons the record twice over: the accounting
credits a fix nobody made, and the reopen policy loses the signal that this
mode has "gone away" before.

## Decision rules

- **Caps with a spelled overflow state.** Under a failure storm, promotion
  itself must not flood the queue; when the cap trips, the layer emits one
  meta-incident ("promotion saturated: N signatures suppressed, window W")
  rather than dropping overflow silently — the count carries its predicate,
  and the suppression is itself visible.
- **Promotion is idempotent under replay.** Sweeps and scans re-run; the
  trigger evaluation must attach to the existing incident on re-encounter, not
  mint a duplicate — this falls out for free if identity truly derives from
  the signature, and breaks immediately if any per-run salt leaks into the
  key.
- **The futility trigger is the healer's humility, wired in.** It must not be
  disable-able separately from the healer itself; a deployment that wants
  autonomous healing accepts autonomous confession as part of the same
  package.
- **Track promotion latency.** The elapsed time from first occurrence to
  promotion is the operator's blind window; if the median stretches, the
  thresholds have drifted from the failure mix and the machine is sitting on
  patterns it should be surfacing.
