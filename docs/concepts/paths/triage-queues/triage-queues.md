---
layer: golden-path
subject: triage-queues
status: forged
techniques:
  - source-normalization
  - queue-ordering-and-identity
  - verdict-writeback
  - focus-mode
  - bulk-triage
  - queue-lifecycle
evidence:
  - src/features/agents/quick-answer/triage/useUnifiedTriage.ts    # seven-source fusion: adapters, per-source failure ledger, capped-source honesty, optimistic verdicts with restore, CAS-conflict-as-decided
  - src/features/agents/quick-answer/triage/triageQueue.ts         # pure projection: removal-not-index cursor, bounded skip that stands down but stays counted, progress denominator = decided + pending
  - src/features/agents/quick-answer/triage/deck/useDeckControls.tsx  # focus deck: keyboard/gesture verdicts, in-flight lock doubling as the queue, watchdog against a wedged deck
  - src/features/plugins/companion/inbox/hooks/useUnifiedInbox.ts  # four-source read-model merge through per-source adapters, newest-first, capped scan surface
  - src/features/overview/sub_incidents/libs/incidentTaxonomy.ts   # nine source tables normalized to one row shape: severity rank, per-source label/icon/guidance
  - src/features/fleet/monitor/grid/fleetGridModel.ts              # the actionable predicate in code (actionBadges / dominantBadge, moved here 2026-08-26 from the retired triage/triageModel.ts, deleted 2026-09-02): failed/review/input/draft counts admit; running-or-queued alone is "busy", hidden
  - src/features/overview/sub_manual-review/hooks/useManualReviewQueue.ts  # badge counts and rows derived from the same server-side filtered source (counts layer + keyset pages)
counter_evidence:
  - src-tauri/db/src/repos/dev_tools.rs   # pending_counts: a hand-enumerated registry of 6 human-decision queues while 13 exist — 314 of 370 waiting items (84.9%) invisible to the badge; the registry-completeness failure this subject warns about
deviations:
  - w4-triage-queues   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-hitl-approval   # the 7-day auto-RESOLVE sweep writes the human verdict vocabulary and takes exactly the population the other exit policy protected — registered in golden-path-deferred-fixes.md
---

# Triage queues & operator inboxes

Every system that runs while its operator is elsewhere accumulates moments
where a human should look at something: a finding a scanner raised, an
incident a monitor detected, a message a counterpart sent, a proposal an
automated process drafted. Each producer, left to itself, grows its own
little list with its own shape, its own badge, and its own corner of the
interface — and the operator's day becomes a patrol route across N surfaces,
each of which must be visited to learn that it is empty. A triage queue is
the structural answer: **one ordered surface that fuses every "a human should
look at this" item into a single work stream, presented in the order the
operator should work it, with the verdict controls in place.**

The boundary with the neighbouring subject matters and is worth stating
precisely. [Human-in-the-loop approval](../hitl-approval/hitl-approval.md)
owns *gates*: a machine action is suspended at a consequence boundary and a
verdict unlocks or cancels the execution — the item is a lock, and something
is waiting behind it. Triage queues own *inboxes*: the items are findings,
incidents, messages, and proposals that no machine is blocked on — **the item
is the work itself, not a lock on other work**. The two share their fatigue
economics and part of their surface design (an approval, once pending, is a
legitimate queue item), but they diverge on everything downstream of the
verdict: a gate resumes or cancels a suspended execution; a triage verdict
*is* the resolution. Where an inbox item happens to be an approval, the
gate's semantics govern — route through the approval subject's
[review-queues](../hitl-approval/techniques/review-queues.md) discipline
rather than reinventing verdict-binding rules here.

A triage surface is also **not a [table](../table/table.md)**, however much
it may visually resemble one. A table is a browsing surface over a collection
the user explores: they sort by whatever column they like, filter to any
subset, paginate through thousands of rows, and the collection's persistence
is the point. A triage queue inverts every one of those properties. Its
ordering is *policy*, not preference — the queue asserts what should be
handled first, and letting the operator casually re-sort it defeats the
assertion. Its items are *transient by design* — success is items leaving.
Its unit of interaction is the *verdict*, not the inspection. And its
healthiest state is the one no table is built for: **empty**. Borrow a
table's rendering machinery if convenient; never borrow its interaction
model.

## The four load-bearing walls

Four properties hold the subject up. Remove any one and the surface degrades
into something worse than the N lists it replaced — because now the operator
*believes* there is one place to look, and the belief is false.

### 1. Normalization: N shapes in, one contract out

The value proposition is "one surface", and one surface requires one item
shape. Every source — however alien its native schema — is translated by an
adapter into a single item contract: stable identity, source tag, severity,
timestamp, human-readable summary, the verdict set the item admits, and a
deep link back to its origin. The moment two sources leak their native
shapes past the adapter boundary, every downstream feature (ordering,
grouping, bulk verdicts, keyboard handling) forks into per-source cases, and
the unified surface becomes N surfaces wearing one frame. Normalization is
the foundation, not a convenience — see
[source-normalization](techniques/source-normalization.md), including the
honesty requirement that a source which *failed to load* is reported as
failed, never as empty.

Normalization has a prior question that decides more than any adapter does:
**which producers are registered at all**. The fused surface is only as
complete as its roster of sources, and the roster is a maintained artifact —
every subsystem that starts producing "a human should look at this" items
must be admitted to it, or its items wait in a queue no unified surface
reports. This failure is empirically the subject's largest: measured on a
mature system, a hand-enumerated roster covered six of thirteen
human-decision queues, leaving 85% of all waiting items — including the two
largest queues — invisible to the surface and its badge. And invisibility is
not cosmetic: **visibility and drain are the same variable**. Queues on the
roster get worked to zero; queues off it are never drained by a human at
all, and their items age until an automated sweep disposes of them. Treat
the roster the way the adjacent approval subject treats
[queue completeness](../hitl-approval/techniques/review-queues.md) —
structural, derived from where pending state lives, never a curated feed
producers opt into — and treat "new producer, no roster entry" as a defect
of the same class as a dead link.

### 2. The actionable predicate: busy is not needs-me

The queue admits an item only if **a human decision changes its outcome**.
That predicate sounds obvious and is violated constantly, because producers
find it flattering to surface their activity: work in progress, things that
succeeded, states that are merely interesting. An operator inbox that mixes
"needs me" with "is happening" trains the operator that most items need
nothing — which is the same fatigue mechanism that kills approval gates,
here killing the inbox instead. Status belongs on dashboards; progress
belongs in [async-ui-states](../async-ui-states/async-ui-states.md);
announcements belong in
[toasts-notifications](../toasts-notifications/toasts-notifications.md). The
queue is reserved for the strict subset where judgment is the missing input.
The discipline has a corollary for producers: an item must arrive *with*
the context needed to judge it, because an item that forces a research
expedition before every verdict fails the predicate in practice even when it
passes in principle.

### 3. Ordering as policy, identity under mutation

The queue's order encodes the operator's real priorities — severity first,
then age, then impact, or whatever the domain demands — and the ordering
must be deterministic and total, so the same items always present in the
same sequence. Harder and more important: the ordering must **survive
concurrent mutation**. Items arrive while the operator works; verdicts
remove items mid-pass; a refresh must neither shuffle what the operator is
looking at nor resurrect what they just resolved. The only foundation that
survives this is stable per-item identity plus cursors expressed as
*removal from a set*, never as *position in an array* — the full argument is
[queue-ordering-and-identity](techniques/queue-ordering-and-identity.md).

### 4. Verdict write-back: the decision must land

A triage surface aggregates *reads* from N sources, but every verdict is a
*write* to exactly one of them — the system that owns the item. A verdict
that renders as done on the surface but never lands in the owning store is
strictly worse than having no queue: the operator's judgment is consumed and
discarded, the item resurrects on the next visit, and after the second
resurrection the operator stops trusting every verdict the surface ever
showed. Write-back is therefore a reliability problem, not a UI detail:
verdicts route through a per-source dispatch, failures are reported per
item rather than swallowed into a batch, and the surface never displays
"resolved" ahead of confirmation without a visible path back when the write
fails — see [verdict-writeback](techniques/verdict-writeback.md).

## Hygiene: the queue must tend toward empty

A queue is a flow, not a store. Items enter when a producer raises them and
must *leave* through one of a small set of named exits: a verdict resolves
them, a deduplication merge absorbs them, or an expiry policy retires them
to a safe terminal state. A queue with entrances but no reliable exits dies
of accumulation — first the count stops meaning anything, then the ordering
stops mattering because nobody scrolls past the first screen, and finally
the operator stops opening it, at which point every producer that trusted
the queue as its delivery channel is silently shouting into a void. Growth
without bound is not a scaling problem; it is a design smell that some
producer is violating the actionable predicate or some exit is broken.
Dedup, resolution recording, expiry, and the deep-link contract are
[queue-lifecycle](techniques/queue-lifecycle.md).

## The economics: attention is the budget

Triage queues and approval gates draw on the same finite resource — the
operator's willingness to read before acting — and they overdraw it the same
way. Every item that turns out to need nothing debits trust; enough of them
and the operator processes the queue mechanically, verdicting without
reading, and the surface's throughput metrics improve as its value drops to
zero. The countermeasures are shared with the
[approval subject](../hitl-approval/hitl-approval.md) and worth restating in
inbox terms:

- **Guard the entrance.** The actionable predicate is the tiering rule;
  producers do not get queue access by default.
- **Make each verdict cheap.** Context in place, single-key decisions, no
  navigation per item — the strongest form is a dedicated
  [focus-mode](techniques/focus-mode.md) that presents one item at a time
  with the whole verdict set on the keyboard.
- **Batch the homogeneous.** Twenty items of one shape and one risk class
  are one decision — but bulk verdicts carry a safety asymmetry that must
  be designed, not assumed ([bulk-triage](techniques/bulk-triage.md)).
- **Let resolution feed back.** A source whose items are dismissed at 95%
  for a month is failing the predicate; the queue is the instrument that
  can measure this, if verdicts are recorded per source.

## What this subject deliberately excludes

- **Blocking gates.** Anything where a machine waits on the verdict —
  approvals, consents, resume-after-decision — belongs to
  [hitl-approval](../hitl-approval/hitl-approval.md), even when it is
  *displayed* inside a unified inbox.
- **Pure notification delivery.** Fire-and-forget announcements with no
  verdict are [toasts-notifications](../toasts-notifications/toasts-notifications.md);
  an inbox is distinguished by the verdict set, not by the badge.
- **The producers themselves.** Detection quality — whether an incident
  monitor or a scanner raises the *right* items — is the producer's subject
  (e.g. [error-handling](../error-handling/error-handling.md),
  [background-jobs](../background-jobs/background-jobs.md)). The queue's
  responsibility begins at the adapter and ends at the write-back.

## The techniques

- [source-normalization](techniques/source-normalization.md) — adapters
  from N native shapes to one item contract; preserved per-source metadata;
  honest per-source counts.
- [queue-ordering-and-identity](techniques/queue-ordering-and-identity.md) —
  stable identity under refresh and concurrent mutation; removal-based
  cursors; priority policy; grouping versus flat.
- [verdict-writeback](techniques/verdict-writeback.md) — routing each
  verdict to its owning backend; partial-failure reporting; optimistic
  display with confirmation.
- [focus-mode](techniques/focus-mode.md) — one-at-a-time presentation;
  keyboard and gesture verdicts; in-flight locks with watchdogs; bounded
  skip semantics.
- [bulk-triage](techniques/bulk-triage.md) — multi-select verdicts; the
  asymmetry between bulk-dismiss and bulk-accept; selection integrity under
  refresh.
- [queue-lifecycle](techniques/queue-lifecycle.md) — dedup on arrival;
  resolution recording; expiry to a safe state; deep links to origin.
