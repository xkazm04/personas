---
layer: technique
subject: hitl-approval
technique: unattended-mode
status: forged
laws: [gate-sees-target, creation-names-reaper, count-carries-predicate]
shared_with: []
---

# Unattended mode

Sometimes the operator legitimately wants the machine to run without asking:
the overnight batch, the bulk migration, the pipeline that has earned its
track record, the demo that must not stall on a modal. Unattended mode is the
**honest form of that trust** — an explicit, scoped, expiring, audited grant
of auto-approval — and it exists because the dishonest form is always
available: an operator who cannot get a sanctioned opt-out will manufacture
one by approving reflexively, and reflexive approval corrupts the audit trail
while a sanctioned grant preserves it. Offering unattended mode is not a
weakening of the gate discipline; it is the discipline extended to cover the
case where gating is genuinely not wanted.

## Through the gate, not around it

The single most important design decision: unattended mode is **a policy that
answers at the gate, not a bypass that skips it**. The action still arrives
at the checkpoint; the checkpoint still evaluates the trigger; the pending
question is still formed — and then the standing grant answers it, recording
an auto-approval attributed to the grant. Nothing anywhere calls the action
directly because "we're unattended tonight".

Everything valuable follows from routing through rather than around:

- **Disabling is instant and total.** Revoke the grant and the very next
  action finds a silent gate and asks a human. A bypass, by contrast, is a
  second code path whose removal is a change, a deploy, a risk.
- **The audit trail is uniform.** Attended and unattended runs produce the
  same records with different deciders; nothing that ran is invisible.
- **The gate keeps seeing its target**
  ([gate-sees-target](../../_laws.md#gate-sees-target)) — triggers keep
  firing and being measured even while auto-answered, so the operator can
  later ask "what *would* have asked me?" and get a real answer.

## The grant is scoped, never total

"Run everything unattended" is not a grant; it is the mechanism's deletion
with extra steps. A grant names:

- **Which actions** — the classes or gates it answers for, enumerated. The
  four mandatory-gate categories deserve individual mention: a grant covering
  routine spend under a ceiling is sane; a grant that silently swallows
  irreversible deletions was almost certainly not what the operator meant,
  and the grant surface should make that scope impossible to enable by
  accident.
- **Which agents or processes** — trust is per track record, and track
  records belong to actors, not to the fleet.
- **Ceilings** — per-action and cumulative bounds in units of consequence:
  total spend, item counts, blast radius. A grant with ceilings converts
  "trust the machine tonight" into "trust the machine tonight *up to this
  much*", which is what the operator actually meant.

## The grant expires

A standing grant is created state and names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)). Time-boxing
is the default posture — tonight, this run, this week — because trust
extended for a purpose should end with the purpose. A permanent grant is a
different, heavier decision (a configuration default, deliberately made and
separately visible), never the quiet residue of a temporary one that nobody
turned off. The expiry event itself is safe: gates re-arm and ask; nothing
mid-flight is killed, it simply waits like any pending item.

## Ungated is not unrecorded

Every action taken under the grant is recorded **as if it had been reviewed**
— the same decision record, decider = the grant, plus the disclosure that
*would* have been shown. This produces the retrospective review surface: the
morning after, the operator reads what ran, with counts that carry their
predicates ("42 auto-approved under grant G, of which 3 exceeded half their
ceiling" — [count-carries-predicate](../../_laws.md#count-carries-predicate)),
and either ratifies the night's work with a glance or finds the surprise
while it is one night old. Retrospective review is unattended mode's half of
the fatigue bargain: attention is not eliminated, it is *moved* to a batched,
scheduled, cheaper position.

## The circuit breaker

A grant states the conditions of its own suspension. Anomaly re-arms the
gates mid-grant: error rates above threshold, spend velocity out of profile,
an action class outside the enumerated scope, a ceiling reached. The breaker
resolves to *pending*, not to silent failure — the machine stops auto-
proceeding and starts asking again, and the queue explains why ("grant G
suspended: cumulative spend ceiling reached"). An unattended run that hits
its breaker and stalls until morning is the mechanism succeeding, not
failing; the alternative — a grant that keeps answering yes while the error
rate climbs — is the one outcome the operator would never have approved of
in person, being approved in their name all night.
