---
layer: golden-path
subject: model-routing
status: forged
techniques:
  - turn-classification
  - effort-calibration
  - routing-policy
  - consumer-overrides
  - capability-floors
  - policy-governance
evidence:
  - src-tauri/src/companion/model_routing.rs            # TurnTier { model, effort } — MAIN/ASIDE/MICRO, each constant carrying its bench measurement (incl. a negative result)
  - src-tauri/src/companion/session/                  # bench env overrides applied at the main-turn consumer, not the router; validated levels; override feeds flag AND ledger column
  - src/features/settings/sub_byom/libs/byomHelpers.ts  # policy-as-data validation: blocked-list typo = blocking error (evaluator silently drops unparseable entries), block-beats-allow warnings
  - src/features/settings/sub_byom/libs/useByomSettings.ts  # one policy surface: save gated on blocking errors; refuses save after failed load to prevent silent policy wipe
  - src-tauri/db/src/repos/execution/provider_audit.rs  # append-only decision record (model_used, was_failover, routing_rule_name, compliance_rule_name) + per-provider usage timeseries
  - src-tauri/db/src/model_routing.rs                   # rule cascade carrying both model AND effort, specificity precedence, validate() rejecting unknown effort levels
  - src-tauri/engine/src/prompt/capabilities.rs         # the terminal named constant — DEFAULT_CAPABILITY_MODEL, docstring citing the dated cost incident that justified it
  - src-tauri/src/engine/runner/mod.rs                  # the mid-tier floor: no resolved model on the default provider → pinned constant, never the account default
  - docs/development/model-effort-guide.md              # measured effort-inversion, judge family bias (ρ=0.50), output-cap nullification — with predicates and scope caveats
counter_evidence:
  - src/features/settings/sub_byom/components/ByomAuditLog.tsx  # the audit surface whose model_used column has never been written (NULL on 4,001 of 4,001 live rows) — a record that exists and cannot answer the question it renders
deviations:
  - w8-model-routing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Model routing & provider policy

A system that delegates work to language models does not make one kind of call. It
makes a human wait for an answer; it summarizes a title in the background; it fires
hundreds of tiny classification calls from a batch job overnight. These calls differ
by orders of magnitude in cost, in latency budget, and in the blast radius of a bad
answer — and the models available to serve them differ by the same orders of
magnitude in price and capability, along a second axis (how hard the model reasons)
that is priced separately from the first. **The subject of this path is the routing
decision**: which capability tier and how much reasoning effort each call gets, who
decided, under what policy, and how anyone finds out afterward.

Two siblings border this path. Cost-metering owns the spend ledger — what the calls
actually cost, priced and aggregated; this path produces the decision record that
metering prices. [Retry-backoff](../retry-backoff/retry-backoff.md) owns what
happens when a chosen provider fails — the
[circuit-breakers](../retry-backoff/techniques/circuit-breakers.md) and failover
mechanics; this path owns what the substitute is *allowed to be* when failover asks
(see capability-floors). The seam is clean: routing decides, failover retries,
metering bills.

The stakes are shaped by a property no other subsystem has: **a mis-route does not
error — it produces a plausible answer.** Over-routing (a frontier tier serving
boilerplate micro-calls) burns budget invisibly; nothing breaks, spend just
multiplies until someone audits. Under-routing degrades quality in ways users feel
before any dashboard shows it, because the small tier's failure mode is confident
mediocrity, not a stack trace. Both directions fail silently, which is why this
subject is as much about audit and governance as about the choice itself.

## The core stance: route by class, not by vibes

The naive design lets each call site pick a model — a name string here, a
convenience default there, a "this felt like it needed the big one" in review. It
fails three ways at once: the choices drift apart as the roster of available models
changes under them; nobody can answer "what serves our interactive turns today?"
without grepping; and every intuition baked into a call site is an unmeasured claim
that hardens into fact.

> **The call's class — assigned where the call originates, mapped through one
> table, calibrated by measurement — selects the tier and effort. No call site
> names a model.**

The consequences of that stance form the spine of this subject:

1. **Classification is a closed vocabulary with one authority.** A small, fixed
   set of call classes — the interactive turn a human is waiting on, the
   background aside, the headless micro-call — each carrying a tier and an effort
   setting. The caller asserts its class, because only the caller knows its role;
   the mapping from class to tier lives in exactly one place (see
   turn-classification).
2. **The mapping is calibrated by measurement, and the measurements keep
   surprising.** More reasoning effort is not automatically better — on long-form
   work it can invert. The bigger model is not automatically the safer default.
   Under a hard output cap, effort buys nothing at all. Intuition gets every one
   of these wrong, which is why the class→tier table is an empirical artifact
   with a re-measure cadence, not a settings page of opinions (see
   effort-calibration).
3. **Policy is data, evaluated at one door.** Allow/block lists, complexity
   rules, compliance tags scoped to domains — expressed as data, validated when
   edited, and applied by a single evaluator every call passes through. Policy
   sprinkled across call sites is policy minus the call site added next quarter
   (see routing-policy).
4. **Overrides live at the consumer, never inside the router.** Pins, incident
   downgrades, bring-your-own-provider choices — all legitimate, all applied at
   the call's edge with a stated precedence. An override read from the
   environment *inside* the router is an invisible global: it changes every
   decision, appears at no call site, and survives into contexts where nobody
   remembers setting it (see consumer-overrides).
5. **Some capabilities have floors.** Below a measured minimum tier, a feature
   is not cheaper — it is broken. Floors are per-capability, recorded with the
   measurement that justified them, and no cost pressure or failover routes
   beneath one silently (see capability-floors).
6. **Every decision is auditable, and policy changes are governed.** Which model
   served which call, selected by which rule, with which override applied — as a
   record, not a log line. Policy edits are diffed, reviewed, and approved,
   because a routing change is a spend change and possibly a compliance change
   (see policy-governance).

## The classes and their contracts

The taxonomy below is the recurring shape; a given system may split a class, but
the axes — who waits, what a bad answer costs, how much output is expected — are
the axes everywhere.

| Class | Who waits | Contract |
|---|---|---|
| **Interactive main turn** | a human, synchronously | the strongest tier the budget sustains, effort tuned to the work; latency matters but quality is the bar — this is the product |
| **Background aside** | nobody visibly; the result decorates or prepares | mid tier, low effort; a mediocre answer is absorbed, a slow one is free, an expensive one multiplied by volume is not |
| **Headless micro-call** | a pipeline, at volume | small tier, minimal effort, tight output cap; correctness per call matters less than aggregate cost and throughput, and the cap makes high effort literally unpurchasable |

Three rules cut across the table. First, **the class is semantic, not a model
name** — call sites survive every roster change because they say what they are,
not what they want. Second, **unspecified resolves upward**: a call that names
no model does not get a cheap one — it gets whatever the vendor, account tier,
or runtime defaults to, and those default toward the newest and most capable,
which is the most expensive. So an unclassified call is a routing bug, and the
terminal case of every resolution chain is a **named constant the system owns**,
never a fall-through — a fall-through is a purchasing decision made by someone
who does not pay. Third, **a resolution cascade with many layers and one
populated layer is not a cascade** — it is a constant with extra places to look
before finding it, wearing the costume of a policy. Before adding a resolution
layer, count how many of the existing ones have ever held a value.

## The decision record

A routing decision that cannot be reconstructed afterward is a decision nobody
made. The minimum record, per call: the class asserted, the tier and effort
selected, the policy rule or override that decided (not just the outcome — the
*why*), and whether the served model was the selected one or a fallback
substituted under failure. Aggregated over time, these records answer the
questions this subject exists for: what serves each class today, which classes
are drifting toward expensive tiers, whether an override outlived its incident,
and whether policy is being complied with at all. [Audit-logging](../audit-logging/audit-logging.md)
owns the general discipline of such records; policy-governance applies it here.

## What "done" looks like for this subject

A routing layer meets the bar when: no call site names a model, and every call
carries a class from the closed vocabulary; the class→tier→effort mapping lives
in one place and every entry cites the measurement that set it, with a date;
policy is data with one evaluation door, and an edit that references a retired
tier or unknown tag warns at edit time; every override is applied at the
consumer, visible in the decision record, bounded by policy, and named with the
condition that removes it; capability floors exist for the calls that have them,
and nothing — not cost pressure, not failover — crosses one silently; and an
operator can answer "which model served this call, and why" from the record
alone, without reading source.
