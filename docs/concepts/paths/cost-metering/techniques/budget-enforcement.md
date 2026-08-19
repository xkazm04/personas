---
layer: technique
subject: cost-metering
technique: budget-enforcement
status: forged
laws: [gate-sees-target, one-validation-door]
shared_with: []
---

# Budget enforcement

A budget is a promise that spend stops at a line. Everything else in the
subject informs; this technique is where the product actually refuses to
spend money. The test of an enforcement design is brutally simple —
enumerate the paths that can initiate metered spend, and for each one, point
at the check. Any path without a check is where the overrun comes from, and
[a gate that does not see its target](../../_laws.md#gate-sees-target) is
not a gate.

## Scopes: ceilings live at more than one level

Real budget requirements are nested, and the levels fail differently:

- **Per-run** — a single execution (a job, a chain, an autonomous loop) gets
  a ceiling so that one runaway prompt cannot consume the month. This is the
  tightest loop: checked between steps of the same run, against the run's
  own accumulated spend.
- **Per-actor** — an agent, a persona, an automation identity. Bounds the
  blast radius of one misconfigured actor across many runs.
- **Per-period** — the monthly ceiling against the organization's real
  budget, evaluated against the period ledger sum with the boundary
  semantics of [usage-ledgers](usage-ledgers.md).

A call proceeds only under *all* applicable ceilings. The scopes compose by
conjunction — the strictest one binds — and each refusal names which scope
refused, because "blocked by run ceiling" and "blocked by monthly ceiling"
demand different responses from whoever unblocks.

Two declarations every ceiling carries, both learned the hard way:

- **Its scope and period are part of its identity, not context.** A bare
  configurable number ("budget: 50") *will* be read as a monthly cap by one
  enforcement point and a per-call cap by another — silently authorizing a
  single call the size of the month, or failing every call at the month's
  intended total divided by nothing. The field's name, type, or schema says
  what it bounds and over what period; a number that doesn't say cannot be
  enforced consistently by two readers.
- **The sentinel for "unlimited" is explicit.** Zero and absent are both
  common encodings; whichever is chosen, every enforcement point interprets
  it identically — one gate that treats zero as "unlimited" next to one
  that treats it as "always over budget" pauses real work permanently and
  invisibly.

One structural honesty note: without a reservation step, every ceiling is
check-then-spend — the gate admits a call whose cost is only known after it
completes, so the ceiling can be overshot by up to one worst-case call (or
one per concurrent lane). For fan-out runs this generalizes to **launch-gate
semantics**: the aggregate ceiling bounds "start no new work past the line",
while the per-call cap bounds the call already in flight. The overshoot
bound is a number; declare it rather than implying the ceiling is exact.

## Enforcement points are enumerable, and few

The structural move that makes enumeration tractable: route all metered
calls through **one chokepoint** — the same client wrapper, dispatcher, or
gateway — and enforce there, once. This is
[one validation door](../../_laws.md#one-validation-door) applied to spend:
a check sprinkled across call sites is a check minus the call site added
next quarter. With a chokepoint, the enumeration collapses to "every path
uses the client; the client checks" plus a short, auditable list of
legitimate exceptions.

Two path classes deserve explicit attention because they are where
enumeration typically fails:

- **Unattended initiators** — schedulers, event triggers, retry loops. These
  spend without a human watching, so they carry the *hard* gates
  (see [preflight-estimation](preflight-estimation.md)): a scheduled run
  whose actor or period budget is exhausted is skipped *at trigger time*,
  recorded as skipped-for-budget — a distinct outcome, not a silent no-op
  and not a failure.
- **Amplifiers** — retries, self-healing loops, continuation calls. Each
  amplified call is a fresh spend decision and re-passes the gate; an
  exemption for "internal" retries is the classic enumeration hole, because
  amplifiers are precisely the paths that multiply cost during incidents.

## What a blocked call reports

A refusal is a first-class outcome with a contract, not an exception that
bubbles into a generic error path:

- **Machine-readable**: which scope, which ceiling value, current spend,
  and the period window if period-scoped — enough for a caller to decide
  whether to queue, degrade, or surface.
- **Human-actionable**: the surfaced message says what was blocked, by
  which budget, and what raises it. "Budget exceeded" with no scope sends
  the operator hunting through every ceiling in the product.
- **Recorded**: blocked calls are counted (though they cost nothing) —
  refusal volume is the budget system's own health metric, and a spike in
  refusals is either a legitimate ceiling doing its job or a stale cache
  doing damage, and the count is how you find out which.
- **Never spends.** The block happens before the provider is contacted. A
  "block" that cancels a call already in flight has already paid for the
  input.
- **Overridable where a human owns the budget — explicitly and recorded.**
  A ceiling is an authorization, and the person it protects may
  re-authorize: an interactive block can offer a deliberate "proceed
  anyway", scoped narrowly (this actor, this session) and recorded as an
  override rather than erased as if the ceiling never fired. Unattended
  paths get no such door — there is nobody present to own the decision.

## Ceilings change; caches must hear about it

Enforcement reads two values per check — the ceiling and the accumulated
spend — and both get cached, because the check sits on the hot path of
every call. The cache rules:

- **Ceiling changes invalidate immediately.** When an operator raises or
  lowers a budget, every cached snapshot of that ceiling is stale the same
  instant; a lowered ceiling that takes effect "within the TTL" is a window
  where the product knowingly spends against a revoked authorization. The
  write path for ceilings pushes invalidation; it does not wait for expiry.
- **Spend accumulation may lag bounded-ly.** A short TTL on the spend sum is
  a legitimate trade — the exposure is bounded by (TTL × maximum spend
  rate), which is a number a team can decide to accept. State the bound;
  an unstated TTL is an unstated overdraft limit.
- **The gate reads the same store it enforces.** A gate consulting a
  secondary copy of either value — a frontend mirror, a stale snapshot —
  [is gating a proxy](../../_laws.md#gate-sees-target), and passes exactly
  when the proxy diverges.

## Fail-open or fail-closed, chosen out loud

Eventually the ledger or budget store is briefly unreachable at check time,
and the gate must act without its numbers. Neither answer is free:
fail-closed halts spend and therefore the product's paid functionality
during an internal blip; fail-open keeps the product alive and meters
nothing while it lasts. The technique does not pick a universal winner — it
demands the choice be **explicit, per initiator class, and logged when
exercised**. The defensible defaults run: fail-open for interactive calls
(a human is present, volumes are self-limiting, availability wins),
fail-closed for unattended and amplified paths (nobody is watching, volume
is unbounded, and "the scheduler spent all night unmetered" is the exact
scenario budgets exist for). Every fail-open pass during an outage is
counted and later reconciled against the ledger, so the unmetered window
has a size, not a shrug.

## Smells

- Metered calls from more than a handful of files, no chokepoint —
  enforcement by memo.
- Retry or continuation paths that inherit the original call's gate
  decision instead of re-checking.
- A refusal surfaced as a generic provider error.
- Budget edits that take effect "eventually" (TTL-expiry semantics on
  ceiling changes).
- No stated behavior for ledger-unavailable-at-check-time — which in
  practice means fail-open, undeclared.
- Zero recorded refusals ever: either every ceiling is generous beyond
  reach, or the gates are not actually on the paths that spend.
