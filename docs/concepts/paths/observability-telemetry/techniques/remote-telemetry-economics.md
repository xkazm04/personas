---
layer: technique
subject: observability-telemetry
technique: remote-telemetry-economics
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Remote telemetry economics

Local records cost bytes on a disk you own. Remote telemetry costs
quota on a metered plan, bandwidth on the user's connection, trust on
the user's machine, and — the scarcest resource — **attention in the
triage queue**. Treating the remote channel like a log sink ("send
everything, filter later") fails on every one of those axes at once:
quota exhausts mid-cycle and the channel goes dark exactly when the bad
release ships, the noisy known defect buries the novel one, and the
team learns to skim past the channel, which is the death of it. The
channel is a budget, and everything below is budget discipline.

## The two-tier vocabulary: events are earned, breadcrumbs are free

The load-bearing distinction:

- An **event** is a row in someone's triage queue — a failure or signal
  a human is expected to eventually look at. Events are deduplicated
  and grouped server-side by identity (failure type, location,
  version), so their real cost is not bandwidth but the group they
  create or grow.
- A **breadcrumb** is context that rides in memory — a bounded ring of
  recent happenings — and ships **only attached to an event**. On the
  wire, a breadcrumb that never meets an event costs nothing.

The routing rule: an occurrence earns an event when a human could act
on it — a failure with a fixable cause, a signal that changes a
decision. Everything that is merely *context* (navigations, retries
that succeeded, background hiccups that self-healed) is a breadcrumb:
present in the story when a real failure ships, absent from the queue
otherwise. The failure domain's door routing decides *whether* an
occurrence reaches telemetry; this tier decides *at which class*, and
the default answer for anything ambient is breadcrumb.

Watch the coupling with local log levels: when the sink's error level
maps to a remote event and its warning level to a breadcrumb — a common
and sensible wiring — **level choice becomes a spending decision**. A
codebase that reaches for the warning level by habit fills the bounded
breadcrumb ring with noise, so the trail that ships with a real event
explains nothing; a metronomic error-level record is a recurring charge
against the quota. Level inflation is invisible locally and expensive
remotely, which is exactly why nobody notices until the channel drowns.

Two abuses to ban by review:

- **The metronome event** — a periodic heartbeat or per-run "it
  worked" shipped as an event. It buys a growing group nobody reads
  and spends quota on the absence of news.
- **The loop without a limiter.** Any failure that can recur in a
  tight loop (a poll, a reconnect, a render cycle) gets client-side
  dedup or rate capping before the channel — the server's grouping
  protects the queue, but only the client can protect the quota.

## Batching and the session envelope

Ship on a cadence, not per record: accumulate into a session-scoped
batch and flush on interval, on threshold, and at orderly shutdown.
Batching amortizes connection cost, gives compression something to
work with, and creates the natural place for the client-side cap —
"at most N events per session" is enforceable only where the session
is assembled. The flush-at-exit path is best-effort by design; anything
that must survive a dying process belongs to the crash store
(crash-record-storage), not the network.

## Sampling: send less, know how much less

Above a volume threshold, representative beats exhaustive. Sampling is
legitimate at two points — session level (this install reports fully or
not at all this session) and class level (high-volume event classes
ship at a stated fraction). The non-negotiable, per
[count-carries-predicate](../../_laws.md#count-carries-predicate): **the
rate travels with the data**. A count derived from sampled telemetry
without its sampling rate attached will be read as an absolute by the
next person, and every decision downstream of that reading inherits the
error silently. Where the platform supports it, ship the rate as a
field; where it does not, the rate lives in the channel's documentation
and in every dashboard title that shows the number.

## Quota-aware degradation

The channel must know its budget and degrade deliberately rather than
be cut off at the vendor's edge mid-cycle. Descending order of what to
shed: sampled-down high-volume classes first, then breadcrumb richness,
then non-failure signals — **failure events are the last thing shed**,
because the channel exists for them. A client that has gone quota-dark
records that fact locally, so the silence is diagnosable after the
fact.

## Assert the pipeline, or silence reads as health

The channel's own failure mode is the quiet one: a broken client
integration, an expired key, a network path that eats the batch — and
the dashboard shows *fewer errors*. Zero events arriving is
indistinguishable from perfect health unless something distinguishes it
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Two cheap assertions close the gap: client-side, channel send failures
are counted into the *local* sink (never into the channel itself — a
dead channel cannot report its own death); operator-side, a liveness
expectation on the receiving end — "this product at this volume has
never had a zero-event day" — turns the silent outage into an alert.

## The trust budget: consent and minimality

The user's machine is the other party to this channel. Remote
telemetry ships under a stated policy — what classes of data leave the
machine, toggleable where the product's posture promises it — and the
scrubbing gate from the golden path applies with extra force here:
this is the one store whose contents *definitionally* leave the user's
control. Identifiers are pseudonymous install-scoped tokens, not
account identities, unless the user has been told otherwise; payloads
carry references, not user content. The economic frame and the privacy
frame agree on the conclusion: the channel that ships less is both
cheaper and safer, and the discipline that achieves it is the same
event-vs-breadcrumb gate applied at the source.
