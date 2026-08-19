---
layer: technique
subject: model-routing
technique: policy-governance
status: forged
laws:
  - gate-sees-target
  - count-carries-predicate
shared_with: []
---

# Policy governance

Routing policy is a small file with large consequences: an edited rule can
multiply spend, move regulated traffic across a compliance boundary, or degrade
the product's main surface — all without a line of feature code changing.
Governance is the technique that treats policy changes with the gravity of code
changes and routing decisions with the traceability of financial transactions:
**changes are diffed and approved before they apply; decisions are recorded and
queryable after they happen.** The first without the second approves intentions
it cannot verify; the second without the first audits a policy nobody vetted.

## Policy changes are reviewed diffs

Because policy is data (see routing-policy), a change is diffable, and the diff
is the governance artifact:

- **The change is presented as before/after**, with its blast radius computed:
  which classes, tags, and consumers the edited rules touch, and — where the
  usage record supports it — what share of recent traffic would have been
  decided differently under the new policy. A diff that says "rule 7 changed"
  is a formality; a diff that says "this moves the background-aside class,
  forty percent of volume, up one tier" is a decision someone can actually
  make.
- **Approval is by a human with the authority the change spends** — budget
  authority for tier moves, compliance authority for tag-rule edits. The
  approval, the approver, and the rationale are recorded with the change.
- **Application is atomic and versioned.** The active policy has a version;
  every decision record cites the version it was decided under. Without that
  citation, an audit cannot distinguish "the rule was violated" from "the rule
  did not exist yet" — the two findings that matter most.
- **Emergency changes follow the same path, faster** — an incident downgrade is
  an approved change with an expiry (see consumer-overrides for the reaper
  discipline), not an unlogged hand on the dial. The post-incident review reads
  the same diff trail as any other change.

## The decision record is the audit instrument

Every routing decision writes a record: the class and tags asserted, the tier
and effort selected, the policy version, the rule chain or override that
decided, and whether the served model matched the selection or a fallback
substituted. This record — not the policy file — is what compliance and cost
questions are answered from, because **a gate that reads the policy sees
intentions; only a gate that reads the decisions sees behavior** (law:
gate-sees-target). "The blocklist contains provider X" does not establish that
provider X served no traffic; the decision records do, or fail to.

Two sourcing rules make the record trustworthy. **Record from the final
invocation, not from the configuration** — a record reconstructed from config
describes what the configuration says today, not what ran, and the paths that
diverge (failover, resume, override) are exactly the ones worth auditing. And
**the served model, as reported by the serving side itself, is authoritative
over the caller's pin** — a caller re-stating what it believes it called will
eventually re-state it wrong, and the ledger becomes wrong about the one field
that makes it actionable.

The record is queryable along the axes questions actually arrive on: by class
(what serves interactive turns, really), by consumer (which features route
through overrides), by rule (does this compliance rule ever fire), by outcome
(how often did fallback substitute the selection). [Audit-logging](../../audit-logging/audit-logging.md)
owns the general record discipline — append-only, attributed, retained on a
stated schedule; this technique specifies what routing must put in it.

## Usage timeseries: the drift detector

Individual records answer "why did this call get that model"; the aggregate
timeseries — volume and share per provider, per tier, per class, over time —
answers the slower question of whether routing still matches intent. The
patterns worth alarming on:

- **class drift** — a class's traffic migrating toward expensive tiers without
  a policy change, usually a consumer-override population growing quietly;
- **fallback share rising** — the selection is increasingly not what serves;
  the roster or the failover seam is degrading and routing is masking it;
- **a rule that never fires** — a compliance rule with zero matches over a long
  window is either dead vocabulary or a mis-scoped tag, and both mean the
  protection it documents is not real.

Every number on this surface carries its predicate (law:
count-carries-predicate): share *of which traffic*, counted *by which record
field*, over *which window*. A governance dashboard whose numbers travel
without predicates becomes the source of the next confidently wrong budget
decision. The pricing of this usage — turning call counts into money — is
cost-metering's job; governance consumes its ledger and contributes the
decision records that make the ledger attributable.

## Decision rules

- **The policy surface shows active deviations first.** Live overrides,
  emergency changes awaiting expiry, floors pending re-measurement — the
  governance view leads with what currently differs from the calibrated
  default, because that list is what an operator actually needs.
- **Retention is stated, not inherited.** Decision records answer compliance
  questions, so their retention follows the compliance clock, not the log
  rotation default.
- **The record write is not optional under load.** A routing layer that sheds
  audit writes when busy produces records that are complete except during
  incidents — the exact inverse of when they are needed. Budget the write as
  part of the decision's cost.
- **Review the reviewers' load.** If every micro-adjustment demands full
  ceremony, approvals become rubber stamps; scope the heavy path to changes
  that move spend or compliance boundaries, and let calibration updates within
  a pre-approved envelope flow with lighter review — the envelope itself being
  the thing the heavy path approved.
