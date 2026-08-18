---
layer: technique
subject: self-healing
technique: strategy-selection
status: forged
laws:
  - one-authority-per-vocabulary
  - failure-not-empty-success
shared_with: []
---

# Strategy selection

Between "we know what happened" and "we changed something" sits the decision — and
the decision is where healing systems rot first, because the tempting shape is a
pile of independent handlers each pattern-matching the failure stream and firing
when they like. That shape has no answer to the two questions that matter: *which
single strategy runs for this failure*, and *why that one and not the other*.

## One tree, one winner

Selection is a single component: input, one diagnosis (signature, category,
context, confidence); output, exactly one strategy — possibly the do-nothing
strategy — plus the recorded reason it won. Concretely a decision tree or an
ordered rule list; the shape matters less than the properties:

- **Mutual exclusion is structural, not disciplinary.** Because one component
  returns one strategy, two strategies *cannot* race on one failure. This is the
  property to defend at all costs. Two strategies acting on the same failure each
  mutate the state the other diagnosed: the session-resetter clears the state the
  credential-refresher just installed; the re-queuer duplicates the work item the
  restarter is about to replay. Each individual fix is correct against the world
  it saw; the composition is correct against no world. Where independent handlers
  already exist, mutual exclusion is retrofitted with a per-failure claim — first
  selector to claim the failure owns it, everyone else observes — but the single
  tree is the honest version.

  **And exclusion-by-selection is not exclusion-by-resource.** Some healing
  actors legitimately live *outside* the tree — an aggregate-level watcher that
  rolls back on error-rate regressions is never "selected" for a failure, it
  runs on its own clock (see auto-rollback). The tree cannot exclude what it
  never selects, so any two actors that can write the same surface must share a
  lock on that surface, taken at mutation time. The claim "they operate at
  different levels, therefore they cannot conflict" is the classic false
  comfort: levels are an abstraction over the write set, and the write sets
  overlap or they don't — check the columns, not the concepts. Document, in the
  tree's own contract, the strategies that outrank it or bypass it entirely;
  the exclusion story must cover the whole cast, not just the tree's members.
- **Precedence is a documented contract.** When multiple branches match, the
  winner is chosen by stated rules, in stated order — typically: *most specific
  diagnosis wins* (a signature-mapped fix outranks a category heuristic), then
  *smallest blast radius wins* among equals. The order lives next to the tree,
  in prose a reviewer can challenge, because an accidental precedence (whichever
  branch happens to be checked first) is still a precedence — just one nobody
  chose and nobody will notice when it inverts under refactoring.
- **The strategy set is a closed vocabulary** (law:
  one-authority-per-vocabulary). Accounting keys rates on it, operators filter
  displays by it, budgets meter it. A strategy invented ad hoc at a call site is
  invisible to all three.

## The do-nothing strategy is a first-class citizen

The most common correct decision for a mature healer is to decline — and declining
must be a *recorded selection with a reason*, distinguishable from "no failure
arrived" and from "selector crashed" (law: failure-not-empty-success). Reasons are
an enumerated set of their own:

- **unknown diagnosis** — no branch matched; conservative by design;
- **budget exhausted** — this signature or this window has consumed its healing
  allowance;
- **effectiveness collapsed** — the mapped strategy's confirmed-fix rate for this
  category has fallen below the demotion threshold (see
  effectiveness-accounting);
- **consent absent** — the winning strategy sits in a tier the operator has not
  enabled (see blast-radius-bounds);
- **cooling down** — a recent attempt on the same subject is still inside its
  attribution window, and healing again would destroy the measurement.

Each reason routes differently: unknown-diagnosis feeds the taxonomy-gap report,
budget-exhausted and effectiveness-collapsed feed promotion (see
incident-promotion), consent-absent feeds the operator's pending-consent surface.
A do-nothing lane that collapses all five into one silent skip discards exactly
the signal that would improve the healer.

## Per-category maps, as data

The category → candidate-strategies mapping wants to be data (a table, a config
artifact) rather than branching code, for the same reason breaker thresholds do:
the first month of operation will prove the mapping wrong for at least one
category, and correcting a mapping should be an edit, not a deploy. The tree's
*structure* (precedence, exclusion, budget checks) is code; the *contents* of
"what is even eligible for a credential failure" is data the structure consumes.

## Budgets and cooldowns: the healer must not become the storm

Selection is where volume control lives, because it is the last point before
action:

- **Per-signature attempt caps.** The same signature does not get healed
  unboundedly; after N attempts without a confirmed fix, the signature is
  quarantined from that strategy and promoted. Repetition without learning is
  the noise-generator signature.
- **Per-window global caps.** A burst of failures produces a burst of healing —
  and a healing storm is a storm: every heal is a state mutation plus, usually, a
  triggered re-execution, which is *load*, applied at exactly the moment the
  system is already failing. The storm-control instinct from
  [retry & backoff](../../retry-backoff/retry-backoff.md) applies with more
  force here, because heals amplify state churn, not just call volume. When the
  cap trips, the healer degrades to diagnose-and-record — the observations keep
  flowing, only the mutations stop.
- **Per-subject cooldowns.** One wedged entity does not get serially healed by
  the whole strategy roster in one minute. After an attempt, the subject cools
  until its attribution window closes; the alternative is three overlapping
  half-measured experiments on one patient.

## Decision rules

- **Selection consumes effectiveness history at read time.** Demotion must not
  wait for a human to prune the tree; a strategy whose measured rate collapsed
  is skipped by the same tree that once chose it, with the skip recorded.
- **The tree is testable as a pure function.** Diagnosis in, selection out, no
  side effects until the apply step — which is what makes precedence claims
  checkable in a test instead of discoverable in production.
- **Every selection record names the losing branches when it matters.** At
  minimum, record when precedence actually arbitrated (two branches matched).
  Those are the cases a future maintainer will re-litigate, and the record of
  "B matched but A outranked it" is the difference between a design and an
  accident.
- **Confidence gates aggression.** The tree reads the diagnosis's
  diagnosis-vs-guess marker and restricts guesses to the cheap reversible tiers
  — the epistemic ladder from the golden path, enforced at the branch point.
- **Every guard exemption names its backstop.** Environmental failure classes
  (a provider-wide outage, a stated usage window) legitimately bypass the
  per-subject consecutive-failure gate — punishing one subject for weather is
  wrong — but each class exempted from one guard must be explicitly caught by
  another, and the pairing written down. An exemption without a named backstop
  is unbounded: during exactly the sustained incident that created the class,
  neither guard fires, and the healer schedules fresh attempts forever. Walk
  the guards per failure class and prove each class hits at least one ceiling.
