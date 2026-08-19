---
layer: golden-path
subject: audit-logging
status: forged
techniques:
  - append-only-design
  - write-chokepoint
  - write-path-sanitization
  - best-effort-with-accounting
  - retention-and-partitioning
  - audit-querying
evidence:
  - src-tauri/db/src/repos/resources/audit_log.rs        # the canonical ledger — one chokepoint, no update/delete, sanitize-on-write, counted best-effort failure
  - src-tauri/db/src/repos/resources/api_key_audit.rs    # per-key count cap enforced inside the insert
  - src-tauri/db/src/repos/execution/provider_audit.rs   # separate ledger per domain, append-only
  - src-tauri/db/src/repos/execution/policy_events.rs    # best-effort domain ledger ("enforcement succeeded; this is just the trail")
  - src-tauri/db/src/audit_incidents_promoter.rs         # origin tagging (source_table) + best-effort promotion that never fails the parent insert
  - src/features/settings/sub_api_keys/components/ApiKeyAuditDrawer.tsx   # in-context per-subject query surface
counter_evidence:
  - src/lib/execution/middleware/auditMiddleware.ts      # named "audit", emits diagnostic log lines, not ledger records — the audit/telemetry boundary blurred in code
deviations:
  - w5-audit-logging   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Audit logging

An audit log is the subsystem that answers, after the fact and under
scrutiny, **what the system did and who or what caused it**. Each record is
a claim of historical fact: this actor performed this action on this
subject at this time with this outcome. That framing decides everything
downstream. Audit records are **business records** — they exist for
accountability, dispute resolution, compliance, and incident
reconstruction, and they carry retention obligations. They are not
diagnostic output. A debug line exists to help an engineer understand a
malfunction and can be reworded, resampled, or deleted at will; an audit
record exists to be believed later, by someone with the authority to ask,
and can be none of those things. The moment a team treats the audit trail
as "logs, but in a table," every property this subject depends on —
immutability, completeness accounting, retention discipline — quietly
erodes, because the habits of diagnostic logging (rotate freely, format
casually, drop under pressure) are each a small betrayal of a business
record. Diagnostic logging is its own subject (observability-telemetry)
with nearly opposite economics; the boundary test is simple: *if this line
disappeared, would an engineer be inconvenienced, or would an account of
what happened be missing?*

What is also *not* this subject, though it borders it closely: the
recording of authorization **decisions** — every allow and deny at a
permission gate — which is owned by the
[authorization](../authorization/authorization.md) subject's
[authorization-audit](../authorization/techniques/authorization-audit.md)
technique, and the recording of credential **use**, owned by the
[credential-vault](../credential-vault/credential-vault.md)'s brokered
door. Both are audit ledgers in exactly this subject's sense, and both
apply the disciplines below; what they own is the domain-specific content
of their records. This subject owns the disciplines themselves: what makes
any ledger append-only, complete, clean, bounded, and queryable.

## Append-only is a structural property, not a policy

The value of an audit record is that it cannot have been altered since it
was written. That value is produced by **shape**, not by intention: the
audit module exposes an insert operation and read operations, and *no
update or delete exists to call*. A trail whose store technically supports
mutation but whose team promises not to use it is a trail whose integrity
rests on the discipline of every future contributor — which is to say, it
rests on nothing. When the mutation surface does not exist, "could this
record have been edited?" is answerable by reading the module's exports,
and the answer persuades an auditor in a way a code-review convention
never will.

The corollary is the correction rule: **when a record is wrong, the fix is
a new record that references the old one** — a correction, an annulment, a
supersession — never an edit in place. The erroneous record stays; the
trail shows both the error and its correction, which is itself an audit
fact (someone noticed, someone corrected, at a time, for a reason).
Editing history to make it accurate destroys the very property that made
it worth consulting
([deletion-is-not-repair](../_laws.md#deletion-is-not-repair): removing
the artifact that exposes a defect — here, the wrong record — removes the
evidence, not the defect). The full treatment, including tamper-evidence
options for trails that must convince a hostile reader, is the
[append-only-design](techniques/append-only-design.md) technique.

## One door per ledger, and the writers are enumerable

Every guarantee an audit trail offers — records are sanitized, records are
complete, records carry the required fields, retention is enforced — is a
guarantee about **writes**, and guarantees about writes are only as strong
as the set of write paths is small. The principal-engineer position: each
ledger has exactly one insert chokepoint, every property is enforced
inside it, and the writers that call it are enumerable — you can list
them, and the list is short
([one-validation-door](../_laws.md#one-validation-door)). Audit calls
sprinkled across call sites are an audit trail exactly as complete as the
most forgetful call site; the structural fix is to attach the audit write
to a layer the action *cannot bypass* — a dispatch pipeline, a middleware
seam, the single door the operation already passes through — so that
auditing a class of actions is a property of the architecture rather than
a per-call-site memory. Placement, and what to do when no such seam
exists, is the [write-chokepoint](techniques/write-chokepoint.md)
technique.

## Sanitize before insert — the ledger retains by design

Audit trails and secrets are a uniquely bad combination, because the
trail's defining features — durable, replicated into exports, retained on
a schedule measured in months or years, readable by a wider audience than
the operation it records — are exactly the features you never want a
secret to have. A credential that leaks into an ordinary diagnostic log is
bad; one that leaks into the audit ledger has been **archived**, with an
institutional commitment to keep it. Therefore sanitization happens **on
the write path, before insert** — inside the chokepoint, where it cannot
be forgotten — never as an after-the-fact scrub of stored rows. Scrubbing
after storage is an admission that the secret was retained, copied by
backups, and possibly exported in the interval; and an append-only store,
correctly, resists the scrub. Records carry **references, not values**:
actor identifiers, action names, subject identifiers, outcome codes.
Free-form payloads are the perennial leak vector and get an allowlist and
a size cap, not trust. The mechanics are the
[write-path-sanitization](techniques/write-path-sanitization.md)
technique.

## The best-effort paradox, resolved whole

Two requirements collide at the audit write, and both are non-negotiable:

1. **An audit write must never fail the action it records.** The trail is
   an observer. If the ledger's store hiccups and every recorded operation
   in the product fails with it, the audit system has inverted its
   purpose — it was meant to increase accountability, and instead it
   decreased availability.
2. **A silently unaudited action is a hole in a business record.** A trail
   with unknown gaps is not a trail; it is a sample of unknown bias
   presented to auditors as a census.

Teams reliably implement the first half — wrap the write, swallow the
error, move on — and stop, which converts every infrastructure hiccup into
invisible trail corruption. The resolution keeps both halves: the write is
best-effort, **and every failed write is counted and surfaced** on a
health surface someone actually watches
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). "The
trail has known gaps, here is the number" is an honest ledger; discovering
gaps during an audit is how a trail loses its authority permanently. This
was learned independently at the credential vault's brokered door — audit
must not block use, but unaudited use is a counted, surfaced gap — and it
generalizes to every ledger. The counter's design, its own failure modes,
and what "surfaced" concretely requires are the
[best-effort-with-accounting](techniques/best-effort-with-accounting.md)
technique.

## Retention is policy, enforced where records enter

Audit records have obligations in both directions: some must be **kept**
(compliance windows, dispute horizons) and none may be kept forever
(storage, privacy exposure, and query performance all degrade unbounded).
The principal-engineer stance: retention is a **stated policy per ledger,
enforced mechanically at the insert path** — the door that admits record
N is the same door that retires the records now beyond the horizon — so
the trail's size is an invariant maintained continuously, not a cleanup
job someone remembers to run
([creation-names-reaper](../_laws.md#creation-names-reaper): the audit
record's reaper is named in the very policy that admits it). And because
obligations differ by domain — security events, operational events,
configuration changes rarely share a horizon — **ledgers are partitioned
by domain**, each with its own policy, rather than pooled into one table
where the longest obligation forces the largest bill and one domain's
volume evicts another's evidence. Partitioning, caps, and the subsystem
tagging that keeps aggregates honest are the
[retention-and-partitioning](techniques/retention-and-partitioning.md)
technique.

## An unqueryable trail satisfies no auditor

The trail's read model is part of its contract, not an afterthought. The
questions the trail exists to answer — *what did this actor do in this
window*, *who touched this subject*, *what happened around this incident*
— must be answerable as **queries**, by the people entitled to ask them,
without an engineer reconstructing history from raw storage. A trail that
can only be read by the team that wrote it has an audience of exactly the
people an audit is supposed to check. This sets the record's minimum
schema (the fields you filter by are the fields every record must carry:
actor, action, subject, time, outcome), demands the trail be reachable
from the surfaces where its subjects live, and — the part teams forget —
gives the read model its **own access control and its own audit**,
because reading an audit trail is itself an auditable act. Filters,
in-context surfaces, export, and reader discipline are the
[audit-querying](techniques/audit-querying.md) technique.

## The anatomy of a record

The six techniques converge on what one record minimally carries:

- **Actor** — who or what caused the action, with delegation preserved:
  when an automation acts under a human's standing grant, the record names
  the automation *and* the grant; "the system did it" is not an
  attribution. And an unknown actor is a **recorded value**, never an
  absent field — *unattributed*, *system-initiated*, and *this action has
  no actor* are three different facts a reader must be able to tell apart.
- **Action** — a verb from a controlled vocabulary, not free prose, so
  that filtering and counting stay meaningful
  ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).
- **Subject** — the thing acted upon, by durable identifier so the record
  survives the subject's deletion, *plus* the display name it had at the
  time: the identifier is the fact, the contemporaneous name is the
  caption, and a trail that stores only a mutable name silently rewrites
  its own history at the subject's next rename.
- **Time** — assigned at the chokepoint, one clock per ledger.
- **Outcome** — succeeded, failed, denied; an audit trail of attempts
  without outcomes answers half of every question.
- **Origin** — the domain or subsystem tag that routes the record to its
  ledger and keeps cross-domain aggregates from miscounting.

## The techniques

- [append-only-design](techniques/append-only-design.md) — immutability
  as module shape: no mutation surface, correction-as-new-record,
  ordering, and tamper-evidence options for hostile-reader trails.
- [write-chokepoint](techniques/write-chokepoint.md) — one insert door
  per ledger, enumerable writers, and middleware placement so recording a
  class of actions is architectural, not per-call-site memory.
- [write-path-sanitization](techniques/write-path-sanitization.md) —
  scrubbing secrets and personal data before insert; references over
  values; payload allowlists and size caps.
- [best-effort-with-accounting](techniques/best-effort-with-accounting.md)
  — never block the recorded action; count and surface every failed audit
  write; the honesty contract of a trail with known gaps.
- [retention-and-partitioning](techniques/retention-and-partitioning.md)
  — per-ledger horizons enforced at insert, domain partitioning so
  obligations don't average, subsystem tagging for honest aggregates.
- [audit-querying](techniques/audit-querying.md) — the read model as
  contract: filters by actor/action/subject/time, in-context surfaces,
  export, and access control on the readers themselves.
