---
layer: application
subject: proactive-nudges
technique: attention-budgets
stack: rust
---

# Attention budgets — Athena's daily nudge budget (Personas)

The technique's global-over-per-kind cap structure with atomic claims, as
implemented in `src-tauri/src/companion/proactive/budget.rs` and spent by
the release pass in `src-tauri/src/companion/proactive/mod.rs`.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| Global daily cap | `GLOBAL_DAILY_CAP = 12` (`budget.rs:23`), counted in `companion_proactive_budget(date, count)` |
| Per-kind caps | `kind_cap()` (`budget.rs:31-48`): incidents 6, message-attention 8, execution reviews 4, goal kinds share 2, fallback 3 — counted in `companion_attention_budget(date, trigger_kind, count)` |
| Atomic claim of both | `DailyBudget::try_consume` (`budget.rs:193-230`): one transaction, two conditional `UPDATE ... WHERE count < cap` statements; a per-kind refusal **rolls back** the already-applied global increment, so no phantom spend and no concurrent burst past either cap |
| Claim at delivery, not notice | `evaluate_with_extra_candidates` doc: "The daily budget is **not** consulted here. Noticing is free; only `release_pending` spends attention" (`mod.rs:119-122`) |
| Capped kind skips, never halts | `release_pending` (`mod.rs:427-447`): per-kind refusal `continue`s to the next row; only the global ceiling `break`s. The doc comment records the prior bug — the old loop `break`-ed on any refusal, letting one capped kind starve every kind behind it — and `per_kind_cap_does_not_starve_other_kinds` pins the fix |
| Consented lane | `kind_cap("athena_scheduled") = u32::MAX` (`budget.rs:34-36`): user-requested check-ins are never throttled by their own kind, but still count toward the global ceiling |
| Day boundary | UTC date string as the counter key (`today()`, `budget.rs:233-249`); rollover needs no scheduled job — the next `today()` simply reads fresh rows |
| Efficacy modulation of caps | `effective_kind_cap` (`budget.rs:96-107`): 30-day engaged/dismissed rates move the base cap ±1, only past a 5-sample floor, clamped to `[1, base+2]` — slow, coarse, floored, exactly the technique's adaptation shape |
| Operator visibility | `modulations_summary` (`budget.rs:122-164`) surfaces every kind whose effective cap differs from base, with the engaged/dismissed counts that justify it — counts carrying their predicate |

## Judgment calls worth copying

- **The rollback is the whole point of the transaction.** Global and
  per-kind counters live in separate tables; incrementing global first
  and rolling it back when the kind cap refuses is what makes "must clear
  BOTH" one act rather than two reads. The module doc dates the lesson to
  a real bug hunt ("concurrent passes can never burst past either cap").
- **Conditional UPDATE as the claim primitive.** `UPDATE ... SET count =
  count + 1 WHERE count < cap` returning a row count *is* the atomic
  check-and-decrement — no SELECT-then-decide window, and the same
  pattern claims the `queued → delivered` transition (`claim_delivered`,
  `mod.rs:568-578`, `WHERE ... AND status = 'queued'`).
- **Insert-or-ignore before the conditional update** ensures the counter
  row exists so "no row matched" unambiguously means "cap reached," never
  "first claim of the day."

## Gaps against the technique (reported, not fixed)

- **The day boundary is UTC, not the user's local midnight** (`budget.rs:1`,
  `today()`): for this operator (UTC+2) the budget resets at 02:00 local,
  giving late evenings and early mornings the same allowance day. The
  technique requires the boundary in the user's local time with the same
  timezone honesty quiet windows get.
- **A granted claim is not released on delivery failure.** In
  `release_pending`, `try_consume` succeeds and then a failed
  `claim_delivered` leaves the row `queued` — retried next tick — but the
  budget unit stays spent until the day rolls over (`mod.rs:451-464`
  acknowledges this for the concurrent-delivery case).
- **Modulation never reads the ignored outcome.** `engagement_30d`
  (`budget.rs:81-92`) counts only `engaged` and `dismissed`; a card that
  ages to `expired` (the ignore path, 7 days) contributes no signal, so a
  kind that is purely ignored — the technique's strongest negative — is
  never throttled.
- **A budget side door exists.** `enqueue_external` + `deliver_now`
  (`mod.rs:170-172`, `546-560`) deliver without any budget claim; callers
  include the fleet reconciler, execution review, message triage, and the
  night-shift wake report. Each has a stated rationale ("already won
  triage", "user-requested completion"), but the bypasses are uncounted —
  the technique's "an uncounted bypass is an unbudgeted channel growing
  inside the budgeted one."
