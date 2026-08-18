---
layer: technique
subject: authorization
technique: authorization-audit
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Authorization audit

Every authorization decision is a security event; this technique is about
recording them so that the three questions the system will eventually be
asked — *what happened before this incident*, *why is this user blocked*,
and *is someone probing us* — are queries against a trail rather than
reconstructions from memory. The design divides by decision outcome,
because the two outcomes have opposite economics.

## Denials: record every one, with context

A denial is the single most informative event the authorization subsystem
produces. Every denial is one of exactly three stories:

- a **bug** — the caller should have the permission and the wiring is
  wrong; the denial record is the bug report;
- a **misconfiguration** — a grant was issued too narrow or a requirement
  declared too high; the record shows which side to fix;
- an **attack** — something is calling operations it was never wired to
  call; the record *is* the detection.

All three are urgent, and they are distinguishable only from the record's
context. A useful denial record carries: the **caller channel identity**
(which surface, which consumer key — never the proof value itself), the
**operation** requested, the **requirement demanded vs. what the caller
presented** (tier short, scope missing — name the specific gap), a
**timestamp**, and a **correlation handle** to the request so the caller's
own error can be matched to the trail line.

The record is cheapest when the decision kernel cooperates: a kernel that
returns **the reason rather than a boolean** — which grant authorized,
which rule matched, which requirement fell short — hands the audit line
its content for free, and "who could do what, and why" becomes
reconstructable from the trail alone.

The anti-pattern is the silent gate: refuse, return, record nothing. Its
cost lands twice — the user experiences "the button does nothing" and files
it as a UI bug (a support session spent in the wrong layer), and the probe
sequence that precedes a real exploit leaves no trace. A gate that refuses
without recording has converted its most valuable output into heat.

**Denied-attempt visibility is a surface, not just a table.** Denials
should be countable and visible on the system's own health surface —
a denial *rate* is a signal (a spike is a deploy gone wrong or a probe in
progress) even when no individual line is read.

## Approvals: cheap in the line, reconstructable in aggregate

Recording every allowed call at denial-grade verbosity drowns the trail and
taxes the hot path. The resolution is altitude:

- **Privileged and elevated approvals** are recorded individually — these
  are the lines a post-incident review walks. For operations at the
  brokered-access boundary, the *use* record (who exercised which
  credential, against what, with what outcome) is owned by the vault's door
  and its audit discipline; the authorization trail records *which grant
  authorized the passage* — the two records join on the correlation handle,
  and neither duplicates the other.
- **Public-tier calls** are aggregated (counters, not lines) unless an
  investigation temporarily raises verbosity.
- The reconstruction test defines sufficiency: *"which channels exercised
  which privileged operations in the last N days"* must be answerable as a
  query. If answering requires joining application logs by folklore, the
  trail is decorative.

## The trail never contains what it protects

Audit lines record **references, never values**: channel identifiers, grant
identifiers, operation names, scope names. The proof token, key material,
argument payloads that may embed secrets — none of it enters the trail.
The discipline is structural, not editorial: the audit writer's input type
carries identifiers only, so a contributor cannot pass the secret even
carelessly. An audit trail that quotes proofs is a second copy of every
secret, stored at logging-infrastructure protection levels — the least
protected place the value will ever exist.

## Audit failure is visible, not blocking

The write must not gate the decision — an audit-store hiccup that takes
down every authorized operation inverts the priorities. But the inverse
error is worse and quieter: swallowing write failures leaves holes in the
trail exactly where nobody knows to look. The reconciliation, per
[failure-not-empty-success](../../_laws.md#failure-not-empty-success): the
failed write **increments a visible counter** surfaced on the same health
surface as the denial rate. "The trail has 14 known gaps this week" is an
honest trail; a trail with unknown gaps is not a trail, it is a sample of
unknown bias presented as a census.

The same law governs reading the trail: *zero denials recorded* and *the
recorder was down* must be distinguishable states. An empty trail should be
verifiable against a heartbeat (the recorder writes its own liveness),
never assumed quiet.

## Counts carry predicates

Numbers leave the trail and travel — into dashboards, reviews, incident
reports. Every count that travels states what was counted and how
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
"38 denials" is noise; "38 denials of elevated-tier operations, from
channel class X, counted over the trail between T1 and T2, recomputable by
query Q" is evidence. This matters doubly for authorization because denial
counts drive security decisions — a number that cannot name its predicate
will eventually justify either panic or complacency, and be wrong for both.
