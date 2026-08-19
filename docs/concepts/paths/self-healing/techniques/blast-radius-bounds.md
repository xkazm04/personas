---
layer: technique
subject: self-healing
technique: blast-radius-bounds
status: forged
laws:
  - one-validation-door
shared_with: []
---

# Blast-radius bounds

Ask of any healer one question: *what is the complete list of things it can
change?* If the answer requires reading its source, the healer has no blast
radius — it has a range, discovered empirically, usually during an incident. The
bound is a published, enumerated contract: an **allowlist of mutation types**,
each assigned a risk tier, with the dangerous tiers behind gates the machine
cannot open for itself.

An allowlist, not a denylist. "May touch: work-item status, session lifecycle,
cached tokens" fails safe when a new mutation type appears — the new thing is
untouchable until someone adds it deliberately. "Must not touch: user data,
billing" fails open: the new mutation type is fair game by default, and the
denylist's author was enumerating yesterday's dangers.

## Risk tiers

The useful tiering follows *reversibility and visibility*, not effort:

- **Tier 0 — self-contained, self-reversing.** Clearing a cache, restarting the
  healer's own worker, re-deriving a token, releasing a lease the process holds.
  Wrong at worst costs a warm-up. Autonomous by default.
- **Tier 1 — user-visible but mechanically reversible.** Re-queuing a failed work
  item, resetting a wedged session, forcing a state-machine transition back to a
  known state. A user may notice; the undo is well-defined. Autonomous, but every
  act is accounted and surfaced.
- **Tier 2 — content and configuration mutation.** Editing stored configuration,
  rewriting a persisted artifact, and *any machine-authored fix* (see below).
  Reversal is possible but requires having captured the prior state. **Gated:**
  explicit operator consent, or a development-mode flag — and default-off where
  the product ships to others.
- **Tier 3 — irreversible or externally visible.** Deleting data, invoking
  external services with side effects, spending money, messaging humans. Never
  autonomous. The healer's ceiling here is *proposal*: it prepares the diagnosis
  and the suggested action and hands both to a human gate — this is where the
  machine's lane merges into the operator affordances that
  [health-checks](../../health-checks/techniques/remediation-affordances.md)
  owns and the approval flows that
  [hitl-approval](../../hitl-approval/hitl-approval.md) owns.

Tier membership is decided per *mutation type*, once, in review — not per incident
under time pressure. A strategy is admitted to an autonomous tier only when it can
answer three questions in writing: is re-applying it safe (idempotence)? what is
its undo (see auto-rollback)? and what is the worst state it can leave behind if
interrupted halfway?

## Consent: granular, durable, revocable

The gate on tier 2 is *consent*, and consent has a shape:

- **Granular** — per tier or per strategy, not one master switch. "Allow the
  machine to fix things" is not a decision an operator can reason about;
  "allow automatic session resets" is.
- **Durable** — a stored setting the healer checks on every attempt, not a
  one-time prompt whose answer lives in the affirmative click of six months ago.
  Consent given must be legible later: *what have I authorized this system to do
  on its own?* is a question with a queryable answer.
- **Revocable, taking effect now** — flipping consent off stops the next attempt,
  not the next release. The check happens at selection time, inside the tree, so
  a revocation is honored by the same mechanism that enforces every other bound.

## Machine-authored fixes are hypothesis-tier by construction

A fix generated for a novel failure — by heuristic synthesis or by a language
model — differs in kind from a mapped fix: its diagnostic confidence is
unquantifiable, its blast radius is whatever the generated change happens to
touch, and its failure modes are unenumerated because the fix did not exist until
now. That combination places generative healing in tier 2 *at best*, regardless
of how mundane an individual generated fix looks: the tier bounds the *class*,
and the class includes the worst member, not the average one. The standard
posture: development-mode only, every generated change captured verbatim in the
attempt record before it is applied, and graduation of a *recurring* generated
fix into the mapped-strategy set as a reviewed, human-approved promotion — at
which point it is a diagnosis-lane strategy like any other, with its own
effectiveness row.

## One door: the healer writes like everyone else

The healer's mutations pass through the **same validated write paths as every
other writer** — the same state-transition guards, the same referential checks,
the same audit hooks (law: one-validation-door). The temptation is strong to give
the healer private shortcuts ("it's internal, it can poke the store directly"),
and it is exactly backwards: the healer is the *least* supervised writer in the
system, so it is the writer that most needs the invariants a shared door
enforces. A healer with a private write path can corrupt state in ways no user
action can, which means the corruption will not be found by any test written from
the user's perspective.

Every write is **tagged with the healer's identity** as actor. This is what makes
blast radius auditable after the fact: "show me everything the machine changed
this week" must be a query, not an archaeology project.

## Decision rules

- **The allowlist is enforced at apply time, not assumed at design time.** The
  apply step checks the selected strategy's declared mutation types against the
  allowlist and refuses on mismatch — catching the strategy whose implementation
  quietly grew a new side effect its declaration never mentioned.
- **Interruption is part of the bound.** A healer that dies mid-heal must leave
  either the old state or the new state, never a hybrid; strategies that cannot
  promise this wrap their work in the same transactional machinery the rest of
  the system uses.
- **Bounds are versioned with rationale.** When tier membership changes ("session
  resets promoted from gated to autonomous after 90 days at 92% confirmed"), the
  change is recorded with its evidence — the effectiveness ledger is exactly what
  earns a promotion, and the paper trail is what justifies it during the
  post-incident review.
- **Development-mode gates fail closed in ambiguity.** If the healer cannot
  determine which mode it is in, it is in production.
