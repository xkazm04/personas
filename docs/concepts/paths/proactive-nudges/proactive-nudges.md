---
layer: golden-path
subject: proactive-nudges
status: forged
techniques:
  - trigger-evaluators
  - attention-budgets
  - notice-delivery-decoupling
  - quiet-windows
  - nudge-identity-dedup
  - efficacy-feedback
evidence:
  - src-tauri/src/companion/proactive/mod.rs              # notice/delivery decoupling: cheap unconditional enqueue, dedupe on (trigger_kind, trigger_ref), lifecycle sweep with per-lane expiry, one release path claiming queued→delivered
  - src-tauri/src/companion/proactive/budget.rs           # global daily ceiling + per-kind caps, claimed atomically in one transaction; engagement-modulated (±1, sample floor, clamped ≥1)
  - src-tauri/src/companion/proactive/quiet.rs            # quiet/focus windows: inclusive-from/exclusive-to, midnight wrap, degenerate-window and empty-days semantics pinned by property tests
  - src-tauri/src/companion/proactive/triggers.rs         # pure trigger evaluators — no persistence, no side effects; cadence firing-window contract pinned by property tests
  - src-tauri/src/companion/proactive/incident_triggers.rs # incident nudge: evaluator over open high/critical incidents, trigger_ref anchored on most-severe id for dedupe + deep-link
  - src-tauri/src/notifications.rs                        # per-event delivery preferences — the per-kind opt-out matrix at the delivery tier
counter_evidence:
  - src-tauri/src/companion/night_shift/mod.rs            # enqueue_external + deliver_now side door: direct delivery that skips the budget claim; quiet re-checked only at some call sites, bypass uncounted — the per-kind side channel the decoupling technique forbids
deviations:
  - w10-proactive-nudges   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Proactive nudges & attention budgeting

Everything else in a product speaks when spoken to: the user acts, the
system responds, and however loud the response is, the user opened the
channel. This subject owns the other direction — **machine-initiated
contact**: the system decides, unprompted, that something it noticed is
worth a human's attention, and reaches out. A companion that suggests the
next step, a monitor that surfaces a brewing problem before it becomes an
incident, an assistant that says "you asked me to remind you." The value
proposition is real — an agent that notices things a human would have
missed is doing the job — and so is the failure mode, which is spam.

The line between those two outcomes is not the quality of any single
nudge. It is **policy**: a small set of structural decisions about when
the machine may initiate, how much initiative it may take per day, what it
does with a notice it is not currently allowed to deliver, and how it
learns from being ignored. Products that treat proactivity as a feature
("we can notify!") ship the spam; products that treat it as a *budgeted
privilege* ship the companion. This subject is the policy layer. The
pixels, dwell timers, ledgers, and operating-system escalation the policy
ultimately spends belong to
[toasts-notifications](../toasts-notifications/toasts-notifications.md),
which explicitly hands the initiative question upward to here.

Three more boundaries, each bright:

- **A nudge is not an alert.** An alert says *a system crossed a line
  somebody drew in advance* — a metric breached a threshold, a check
  failed. Its authority is the rule; its audience is whoever operates the
  system; its lifecycle is fire → acknowledge → resolve. A nudge says *an
  agent judged something worth your attention* — a softer, wider, more
  fallible claim, aimed at a person's discretion rather than an operator's
  runbook. The two share mechanics (dedup, cooldowns, suppression) but not
  authority, and merging them degrades both: alerts inherit the nudge's
  optionality, nudges inherit the alert's alarm register. Threshold rules,
  their evaluation loop, and their lifecycle are
  [alerting](../alerting/alerting.md).
- **Suppression primitives are borrowed, not owned.** Cooldowns,
  debounce, and state-predicate suppression are general trigger machinery,
  owned by scheduling —
  [cooldown-and-debounce](../scheduling/techniques/cooldown-and-debounce.md).
  This subject decides *which* of those shapes each nudge kind gets and
  layers attention-specific policy (budgets, quiet windows, efficacy) on
  top.
- **What the agent knows is upstream.** Trigger evaluators read state
  that other subsystems maintain — including the agent's own accumulated
  memory ([agent-memory](../agent-memory/agent-memory.md)). A nudge fed by
  a memory signal is still this subject's nudge; the signal's freshness,
  consolidation, and decay are that subject's problem.

What remains — and it is the hard part — is captured by one sentence:

> **Attention is a budget the machine spends on the user's behalf, and a
> spender that does not account for what it spends will be defunded.**

Every structural decision below follows from taking that literally.

## Noticing is cheap; interrupting is expensive

The first structural move is to split the act everyone conflates.
*Noticing* — evaluating whether a condition worth mentioning currently
holds — is cheap, safe, and should run eagerly and often. *Interrupting* —
placing that notice in front of a human — is expensive, and everything
scarce about this subject (budget, quiet time, trust) attaches to the
second act only.

Noticing is done by **trigger evaluators**: small, pure judgments over
observable state. Each evaluator answers one question ("is there an
unresolved incident the user has not seen?", "has internal pressure
crossed the point where a maintenance pass is due?") and returns either
nothing or a candidate notice — never a delivery. Purity matters because a
fleet of evaluators runs on a shared cadence, and one evaluator that
throws, blocks, or mutates must not silence its siblings: **evaluator
isolation** is the difference between "one broken trigger" and "the
proactive system went dark," and going dark is indistinguishable from
having nothing to say unless failure is spelled differently from empty
success ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).
The evaluator contract, cadence, and isolation are
[trigger-evaluators](techniques/trigger-evaluators.md).

## The budget is claimed, not checked

Caps on daily contact — one **global** ceiling on everything the machine
initiates, plus **per-kind** ceilings so no single enthusiasm exhausts the
whole allowance — are the load-bearing wall of the policy. Two design
points separate a budget that holds from one that leaks:

- **Claims are atomic.** Evaluators race: two triggers firing in the same
  tick both see "one slot left" and both deliver, and the budget is
  overdrawn by exactly the mechanism meant to enforce it. The budget is
  therefore a *claim* operation — check-and-decrement as one indivisible
  act — not a read followed by a decision. A budget you check is advisory;
  a budget you claim is real.
- **The budget is visible.** The operator can see what was spent, on
  what, against which cap ("3 of 5 today, 2 suppressed") — a count that
  carries its predicate
  ([count-carries-predicate](../_laws.md#count-carries-predicate)). An
  invisible budget reads, from the outside, as a system that arbitrarily
  goes quiet; a visible one reads as a system exercising restraint, which
  is the trust the whole subject exists to earn.

Cap arithmetic, claim semantics, day-boundary rollover, and operator
visibility are [attention-budgets](techniques/attention-budgets.md).

## A suppressed notice is deferred, not destroyed

Because noticing and delivering are separate acts, there is a queue
between them, and the queue is where most naive implementations lose
signal. The naive coupling — evaluate, and if delivery is currently
disallowed, drop — means a notice suppressed by budget or by quiet hours
simply vanishes: the machine *knew* something worth saying and forgot it
because the moment was wrong. The correct semantics:

> **Suppression defers; it never deletes. A notice blocked by policy
> waits, and delivers when the window opens — unless it has gone stale,
> in which case it expires with a record.**

Deferral needs its counterweight, expiry, because a notice is a claim
about *now*: "you have an unresolved incident" delivered twelve hours
later may be false, and delivering yesterday's urgency into this morning's
context is its own species of spam. So every queued notice carries an
expiry, and the queue names its reaper
([creation-names-reaper](../_laws.md#creation-names-reaper)) — stale
entries are removed by policy, with a trace, not discovered years later as
a haunted backlog. Queue shape, re-delivery on window-open, re-validation
before late delivery, and expiry are
[notice-delivery-decoupling](techniques/notice-delivery-decoupling.md).

## Quiet time is inviolable, and the bypass is a closed class

Declared quiet windows — hours in which the machine does not initiate —
are the policy's most legible promise, and the one whose violation costs
the most trust per incident. Three disciplines keep the promise:

- **Boundary semantics are pinned.** A window "from 22 to 7" contains a
  midnight wrap, an inclusive edge, and an exclusive edge, and every
  off-by-one lands a nudge at the exact minute the user declared sacred.
  These semantics are pinned by tests over the full boundary surface —
  wrap, edges, degenerate equal-endpoint windows — not left to whatever
  the first implementation happened to compute.
- **The bypass is a closed class, declared in advance.** Some events do
  justify crossing quiet time — the house-on-fire kind. The failure mode
  is bypass creep: each kind's author believes theirs qualifies, and a
  bypass any caller can claim is no quiet window at all. The class of
  quiet-crossing priorities is closed, small, enumerated in one place, and
  extending it is a policy decision, not a parameter at a call site.
- **Timezone honesty.** Quiet windows are declared in the human's local
  wall-clock terms and evaluated against the human's current clock —
  never against server time, and never frozen at declaration time across
  travel and daylight shifts. "Quiet from 22:00" means *the user's*
  22:00, today, wherever they are.

Window declaration, boundary pinning, the bypass class, and timezone
handling are [quiet-windows](techniques/quiet-windows.md).

## The same news twice is spam by definition

A nudge's content can be perfect and its timing legal and it is still spam
if the user has heard it before. Every nudge therefore carries a **dedup
identity** — its kind plus a reference to its subject — minted at notice
time and stable across re-evaluation, re-delivery, and restart
([identity-survives-reuse](../_laws.md#identity-survives-reuse)). The
identity funds three behaviors no per-message cleverness can replace:

- **Dedup** — an evaluator that keeps noticing the same true condition
  produces one live notice, not one per evaluation tick.
- **Per-identity cooldown** — once delivered, the same identity stays
  quiet for a declared interval even if the condition persists; "still
  true" is not "news."
- **Superseding** — a newer notice about the same subject *replaces* the
  queued older one rather than stacking behind it; the user gets the
  current state of the story, once.

Key construction, cooldown layering, and supersede-vs-stack rules are
[nudge-identity-dedup](techniques/nudge-identity-dedup.md).

## Efficacy closes the loop

Everything above rations output. The last mechanism is the only one that
makes the system *converge*: tracking what happened after delivery. Each
delivered nudge resolves to an outcome — **acted on**, **dismissed**, or
**ignored** — recorded per kind, and the per-kind record feeds back into
the per-kind budget:

> **A kind nobody acts on earns a lower budget, not a louder voice.**

This inversion is the heart of the subject. The instinct of every feature
team whose nudges are ignored is to escalate — bigger, earlier, more
often — which spends trust faster on a message the user has already voted
against. The disciplined system reads ignoring *as* the vote: sustained
non-action shrinks that kind's allowance toward a floor, and at the floor
sits a **kill switch** — per-kind opt-out the user can reach from the
nudge itself, honored absolutely. A kind that has been killed is the
policy working, not failing; the alternative is the user killing the whole
channel, or the product. Outcome capture, adaptation rules, and the kill
switch are [efficacy-feedback](techniques/efficacy-feedback.md).

## The techniques

- [trigger-evaluators](techniques/trigger-evaluators.md) — pure judgments
  over observable state, evaluation cadence, and the isolation that keeps
  one broken evaluator from silencing the rest.
- [attention-budgets](techniques/attention-budgets.md) — global and
  per-kind daily caps, atomic claim semantics, rollover, and operator
  visibility.
- [notice-delivery-decoupling](techniques/notice-delivery-decoupling.md) —
  the queue between noticing and delivering, re-delivery when a window
  opens, re-validation of aged notices, expiry.
- [quiet-windows](techniques/quiet-windows.md) — declared windows with
  pinned boundary semantics, the closed bypass class, timezone honesty.
- [nudge-identity-dedup](techniques/nudge-identity-dedup.md) — kind+ref
  identity, per-identity cooldowns, superseding.
- [efficacy-feedback](techniques/efficacy-feedback.md) — acted / dismissed
  / ignored outcomes, budget adaptation, the per-kind kill switch.

Downstream, a nudge that has cleared every gate here is handed to the
delivery tiers of
[toasts-notifications](../toasts-notifications/toasts-notifications.md) —
severity, dwell, ledger, escalation — as one more message among many. The
policy layer's whole output is a trickle of messages that deserved to
exist; making them land well is someone else's craft.
