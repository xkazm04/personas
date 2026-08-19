---
layer: technique
subject: model-routing
technique: consumer-overrides
status: forged
laws:
  - creation-names-reaper
shared_with: []
---

# Consumer overrides

Every routing table meets situations it did not anticipate: a developer pinning
one tier to reproduce a bug; an operator forcing a downgrade while a provider
melts; a user who brings their own provider account and expects it honored; a
single feature that has measured its way to a non-default choice. Overrides are
legitimate. The technique is entirely about **where they live and how they
die** — because an override in the wrong place is a global in disguise, and an
override with no expiry is tomorrow's unexplained routing.

## The one prohibition: never inside the router

The tempting implementation reads an environment variable, a feature flag, or a
config key *inside the routing layer* — one line, instantly effective
everywhere. That line is an invisible global:

- **It changes every decision while appearing at no call site.** A reader of any
  caller sees a class asserted and trusts the table; the actual behavior is
  decided by state the caller cannot see and did not set.
- **It survives context changes nobody audits.** Set in one environment for one
  incident, it rides along into the next deployment, the next machine, the
  colleague's checkout — environments where nobody remembers it exists, because
  nothing in the code names it near any call.
- **It is unattributable.** The decision record can say an override applied, but
  not *whose* or *for which consumer* — the router-level global has no consumer;
  it is weather.

The rule that follows: **the router exposes an override *parameter*; it never
reads override *state*.** Anything that wants to override does so by passing the
override in at the call's edge, where it is visible in the caller's code, scoped
to that consumer, and attributable in the record.

## Precedence, stated once

With overrides at the edge, multiple layers can legitimately speak. Their order
is a documented contract, not an accident:

1. **Policy outranks all overrides.** A compliance rule or a block is not
   overridable by any consumer; an override is a preference *within* the
   permitted set, never an exemption from it (see routing-policy). Similarly, no
   override routes below a capability floor (see capability-floors) — a pin that
   would break the feature is refused, loudly, at decision time.
2. **Explicit per-call override** — the narrowest scope, typically diagnostic.
3. **Consumer-scope configuration** — a feature's or user's standing choice,
   including bring-your-own-provider bindings.
4. **The class mapping** — the calibrated default (see turn-classification).

Ties do not exist in this scheme because each level has one voice; if two
sources at the same level can disagree, they are actually one level with a
missing authority, and that is the bug to fix.

## Every override names its reaper

An override is a deviation from the calibrated table, and deviations rot: the
incident ends, the bug closes, the measurement that justified the pin goes
stale — and the override keeps routing. So every override carries, at creation,
the condition that removes it (law: creation-names-reaper):

- **Diagnostic pins** die with the session or the test run — scoped to a
  lifetime the platform ends automatically.
- **Incident downgrades** carry an expiry or an explicit "until provider X
  recovers" condition, and the governance surface lists them as *active
  deviations*, not as configuration.
- **Standing consumer choices** (a user's own provider) are the one durable
  kind — and they are owned by the consumer, revisited when the consumer's
  account or the roster changes, and visible in every decision record they
  touch.

An override without a reaper is indistinguishable, six months later, from the
calibrated default — except that it is wrong and nobody knows why.

## Decision rules

- **Overrides appear in the decision record by name and scope.** "Override
  applied: consumer-scope, set by X" — an unattributed override in the record
  is barely better than a router global.
- **An override that loses to policy is reported, not swallowed.** The consumer
  asked for something policy refused; silence teaches the consumer the override
  works. The refusal names the outranking rule.
- **Count active overrides as a health metric.** A routing layer where a large
  share of traffic flows through overrides has a routing table nobody believes;
  the fix is recalibration, not more overrides.
- **Test overrides use the same mechanism as production overrides.** A separate
  backdoor path for tests is a second door (and the one that leaks); a
  diagnostic pin is just an explicit per-call override with a test-scoped
  lifetime.
