---
layer: technique
subject: model-routing
technique: routing-policy
status: forged
laws:
  - one-validation-door
  - failure-not-empty-success
shared_with: []
---

# Routing policy

Classification says what a call is; calibration says what serves it well. Policy
says what is *permitted* — which providers and tiers an organization allows at
all, which calls must stay inside a compliance boundary, which work is important
enough to route up regardless of its class's default. Routing policy is the
technique of expressing all of that as **data, evaluated at one door**, instead
of as conditionals accreting at call sites.

## Policy is data

The recurring rule kinds:

- **Allow/block lists.** Providers or tiers an installation permits or forbids —
  the enterprise that bans an external provider outright, the cost-controlled
  environment that blocks the frontier tier for everything but one class. Block
  is the stronger primitive: an allowlist silently strands new roster entries in
  limbo until someone remembers it exists; a blocklist fails open to the default
  mapping, which is usually the intent.
- **Complexity rules.** Route up when the call's measurable properties cross a
  threshold — input size, requested output length, a caller-asserted complexity
  hint. These are the rules most tempted to guess from content; keep them keyed
  to *measurable* properties, because a rule keyed to semantic judgment of the
  prompt is a model call to decide which model to call.
- **Tag-scoped compliance rules.** Calls carrying a compliance tag (a regulated
  data domain, a customer-contractual boundary) must be served only by approved
  providers. Tags are asserted by the caller alongside the class; the rule
  binds tag → approved set. These rules outrank everything below them, because
  their violation is not a quality bug but a breach.

Because policy is data, it can be validated as data. **Every rule is checked at
edit time**: a rule naming an unknown tag, a retired tier, or a provider absent
from the roster gets a warning *when written*, not silence at match time. A rule
that can never match is worse than no rule — it documents an intention the
system is not enforcing, and its author walked away believing otherwise.

## One evaluation door

Every call, from every feature, passes through a single policy evaluator on its
way to a model (law: one-validation-door). The alternative — each call path
remembering to check the blocklist — is the standard sprinkled-validation
failure: the check exists everywhere except the call site added next quarter,
and the audit record cannot even say which calls were evaluated. One door also
makes precedence *decidable in one place*:

1. **Compliance rules first** — a tag-scoped restriction is never overridden by
   anything below it, including consumer overrides (see consumer-overrides:
   an override is a preference within policy, not an exemption from it).
2. **Block beats allow.** A call permitted by one rule and forbidden by another
   is forbidden.
3. **Specific beats general.** A rule scoped to a class or tag outranks an
   installation-wide default.
4. **Then the class mapping**, then calibrated defaults.

Precedence is part of the policy's documentation, not an emergent property of
evaluation order in code. When two rules of equal rank conflict, that is a
policy validation error to surface at edit time — not a coin flip at runtime.

## When policy forbids everything

The evaluator can reach a state where no candidate survives: the class's tier is
blocked, the compliance tag's approved set is disjoint from the roster, the
floor (see capability-floors) sits above everything allowed. This outcome must
be spelled as its own failure — *policy-exhausted, these rules eliminated these
candidates* — never as a silent fallback to whatever remained before the last
rule ran (law: failure-not-empty-success). A silent best-remaining fallback is
the compliance breach the tag rule existed to prevent, executed by the
evaluator itself. The call fails, the record names the eliminating rules, and
an operator can see which two rules collided.

## Decision rules

- **The evaluator returns a decision, not a boolean** — chosen candidate plus
  the rule chain that selected it, ready for the audit record. A yes/no policy
  door forces the caller to reconstruct *why*, which it cannot.
- **Policy references vocabularies; it never defines them.** Classes, tags,
  tiers, and the provider roster each have their own authority; a rule file
  that also declares what tags exist becomes the second copy that drifts.
- **Rules carry ownership and intent.** Each rule names who added it and why —
  a blocklist entry with no rationale is unremovable forever, because nobody
  can prove the reason lapsed.
- **Do not add a layer nobody will fill.** Every rule kind and cascade level
  is a place a future reader must check before concluding "the default
  applied". A layer that has never held a value is worse than no layer: it
  makes the terminal constant look like an emergent policy, and the next
  author adds another layer instead of reading the constant.
- **Evaluate once per call, at decision time.** Re-evaluating policy at retry
  time is correct (the roster may have changed mid-incident); caching a
  decision across calls is how a revoked provider keeps serving traffic for a
  day. The decision is cheap; make it fresh.
- **Policy changes are governed events**, not config pushes — the diff, review,
  and approval discipline lives in policy-governance.
