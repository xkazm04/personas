---
layer: technique
subject: webhook-ingestion
technique: delivery-logging-and-replay
status: forged
laws: [one-validation-door, creation-names-reaper, failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Delivery logging and replay

A webhook failure cannot be reproduced by clicking around: the input came
from another organization's machine, at a moment you did not choose, shaped
by state you cannot see. The delivery record exists to convert that class of
bug from "wait for it to happen again while watching" into "load the bytes
and run them". Everything else in this technique — redaction, verdicts,
replay, retention — is the discipline that lets the record exist without
becoming a liability.

## Record everything, verdict attached

Every delivery that reaches the admission path is recorded — **accepted and
rejected alike** — with:

- arrival time and the ingress mouth it arrived through;
- method, path, headers, and the raw body (bounded; the payload-bounds cap
  already limits it);
- the claimed source or subscription it resolved to, if any;
- the **verdict**: admitted, or rejected with the specific stage and reason —
  bad signature, missing secret, oversize, unknown content type, dedup hit;
- what it minted, when admitted: the internal event's identity, so the record
  links forward into the system's own tracing.

Rejected deliveries are the half people skip and the half that matters: the
sender whose secret rotated wrong, the attacker probing the URL, the
integration that silently changed its payload shape — all of them live
exclusively in the rejected rows. An ingress that logs only successes cannot
distinguish "no traffic" from "all traffic refused"
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)), and
the rejection **counters** the golden path demands are derived from these
rows, reason attached
([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## Redact at write time, not display time

The record is a copy of authenticated traffic, which means it brushes against
secrets: signature headers, bearer tokens a sender includes, credentials
embedded in payloads by badly designed senders. The rule: **sensitive header
values are replaced with a marker before the record is written.** Display-
time redaction — store everything, mask in the viewing surface — fails in
every direction at once: exports bypass the mask, database backups carry the
secrets, and every future reader of the store inherits a disclosure problem
that write-time redaction would have ended at the source.

Redaction is by denylist of known-sensitive header names *plus* a
pattern-based sweep for token-shaped values, because senders invent headers.
The body is harder — payloads legitimately contain data — so body redaction
is per-subscription configuration where the operator knows a sender embeds
secrets, not a universal guess.

And one tension to design as a single decision, never two independent ones:
**redaction and replay consume the same field.** Replay re-delivers the
recorded body; a later hardening pass that blanks the recorded body — without
redirecting replay to an alternate durable copy of the payload — does not
disable replay, it silently converts it into re-delivering the redaction
marker: the feature still runs, still succeeds, and delivers garbage. When
the body must be redacted from the record, replay either reads the payload
from wherever the admitted copy durably lives, or refuses loudly with
"payload redacted" — the one outlawed outcome is a replay that quietly
replays the mask.

## Replay is a feature with a contract

Replay re-injects a recorded delivery into **the same admission door live
traffic uses** ([one-validation-door](../../_laws.md#one-validation-door)).
Not a parallel code path that "does what the handler does" — the entire value
of replay is that it exercises the pipeline that failed, and a replay-only
path is a second pipeline whose agreement with the first decays from the day
it is written.

The contract around it:

- **Replay is explicit and attributed**: initiated by an operator, recorded
  as a new delivery row that names the original it replays and who asked.
- **Dedup treats replay deliberately**: a replayed delivery would be
  suppressed by its own original's dedup mark, so replay declares itself and
  the mint point decides — typically minting a fresh internal event, because
  the operator asked for reprocessing, not for a no-op.
- **Replay re-earns admission; it does not borrow it.** The replayed request
  cannot present the original's signature (masked by redaction, and stale
  against any timestamp window anyway). The strongest form: **re-sign the
  recorded body with the currently configured secret** and enter through the
  front door like any live delivery — which exercises verification itself and
  keeps zero bypass switches in the door. Only when no secret is available
  does replay fall back to an operator-authority admission — a distinct,
  logged reason, never a general "skip verification" flag that live traffic
  could reach.

## Export: the reproduction leaves the building

The record can emit a self-contained reproduction — the request as a
command or file a developer can fire from any machine — with redactions
intact and placeholders where secrets were. Export is what turns "works on
the operator's machine" into a bug report a sender's support team or a
teammate can actually run. The redaction guarantee must hold *through*
export: the exporter renders from the already-redacted record, never from
any rawer source.

## Retention: the record names its reaper

A verbatim traffic log grows without limit and ages into pure liability —
old payloads are rarely debugged and always disclosable. The record
therefore carries its retention policy from birth
([creation-names-reaper](../../_laws.md#creation-names-reaper)): a bounded
row count or age, enforced by the same component that writes, with the bound
visible to the operator. Deliveries an operator has pinned (an open
investigation) survive the reaper explicitly rather than by racing it.
