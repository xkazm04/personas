---
layer: technique
subject: proactive-nudges
technique: attention-budgets
status: forged
laws:
  - count-carries-predicate
  - derivation-names-recomputation
shared_with: []
---

# Attention budgets

The hard ceiling on machine-initiated contact: how much the system may
say per day, in total and per kind of thing it says. The budget is the
policy layer's contract with the user — "no matter how much I notice, I
will not exceed this" — and a contract enforced by a leaky mechanism is
marketing.

## Structure: global cap over per-kind caps

Two layers, both required:

- **Global daily cap** — the total number of machine-initiated deliveries
  per day, across all kinds. This is the number the user would recognize
  as "how chatty is this thing"; it is small (single digits is the right
  starting instinct), and it is the outer wall.
- **Per-kind daily caps** — each nudge kind gets its own smaller
  allowance. Without this layer, one prolific kind (the cheap, frequent,
  low-value one — there is always one) spends the whole global budget and
  starves the rare, high-value kinds. Per-kind caps are the diversity
  mechanism: the day's contact is a portfolio, not a first-come queue.

A delivery must clear **both** — its kind's remaining allowance and the
global remainder. The two checks are one claim (below), not two reads.

## Claim semantics: check-and-decrement is one act

The budget's enforcement point is a **claim**: an atomic
check-and-decrement that either reserves a delivery slot or refuses. The
alternative — read the count, decide, then increment — is a race with a
built-in overdraft: concurrent triggers each observe the last free slot
and each take it. The rules:

- The claim covers global and per-kind counters **together**, in one
  atomic step; claiming the kind slot and then losing the race for the
  global slot must roll back, not strand a phantom spend.
- The claim happens at **delivery time**, not notice time. A notice
  sitting in the deferral queue holds no slot; slots are spent on actual
  interruptions. (Claiming at notice time silently converts the budget
  into a cap on *noticing*, which was supposed to be free.)
- A claim that is granted but whose delivery then fails is **released**
  with a trace. Failed deliveries that eat budget teach the system to be
  silent in proportion to its bugs.

## The day boundary

- Budgets reset on a **declared boundary** in the user's local time —
  typically local midnight — with the same timezone honesty quiet windows
  demand. A budget keyed to server-time midnight resets mid-afternoon for
  someone, and their day gets double allowance while their evening gets
  none.
- Unspent budget **does not roll over**. Attention is not bankable; five
  quiet days do not entitle the machine to a Saturday barrage. Rollover
  budgets recreate the burst the cap existed to prevent.
- The spent-count is a stored derivation of the delivery ledger and says
  so ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
  when the counter and the ledger disagree, the ledger wins and the
  counter is recomputed from it — the arbiter is named in advance.

## Visibility

The budget is operator-visible or it is indistinguishable from caprice:

- Current state reads as a count with its predicate
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)):
  "3 of 5 global today; incident-kind 1 of 2; 2 candidates deferred by
  budget" — never a bare "3".
- Refusals are recorded per kind per day. The deferral queue's depth
  against each cap is the single best early signal that a cap is
  mis-sized or a kind has become noisy.
- The caps themselves are data, not constants — per-kind numbers the
  efficacy layer may lower and the user may edit, with the closed set of
  kinds enumerable in one place.

## Decision rules

- When in doubt, cap lower. An under-budgeted system loses a marginal
  nudge; an over-budgeted one loses the channel.
- **A refused per-kind claim skips that candidate, never halts the
  pass.** The drain loop over pending deliveries stops only at the
  global ceiling; a per-kind refusal moves on to the next candidate.
  The subtle alternative bug — abort the whole pass on any refusal —
  lets one capped kind early in evaluation order starve every kind
  behind it, and it looks correct in any test that exercises kinds one
  at a time.
- **Consented contact gets its own lane.** A check-in the user
  explicitly asked for ("remind me tomorrow") is not a speculative
  nudge; throttling it under its kind's cap breaks a promise the user
  made to themselves. Exempt the consented lane from its per-kind cap —
  but never from the global ceiling, which is the outer wall for
  everything machine-initiated.
- The budget governs machine-*initiated* contact only. Responses to the
  user, and alerts owned by threshold rules, spend from different
  accounts — folding them in either starves nudges or inflates the cap
  until it gates nothing.
- Never bypass the claim "just this once" in code. The only legitimate
  bypass is a priority class declared in the quiet/bypass policy, and
  even that class is counted — an uncounted bypass is an unbudgeted
  channel growing inside the budgeted one.
