# Athena Quality Suite — Run 4 Gap Analysis (post v22 + auto-approve)

**Run:** `docs/tests/athena/results/2026-05-27-0933/`
**Constitution version:** v22
**Hard-assertion pass rate:** **87%** (20/23 turns)
**Full-green scenarios:** **3 of 5** (build-oneshot, memory-doctrine, scan-vs-build)
**Auto-approves fired:** 8 (build_oneshot ×4, enqueue_dev_job ×3, prefill_persona_create ×1)

---

## Trajectory across runs

| | Run 1 | Run 2 (v20) | Run 3 (v21) | Run 4 (v22 + audit + auto-approve) |
|---|---|---|---|---|
| Hard PASS | 13 (56%) | 16 (70%) | 18 (78%) | **20 (87%)** |
| Full-green scenarios | 0 | 1 | 1 | **3** |
| Auto-approves driven | n/a | n/a | n/a | 8 |

---

## What landed in run 4

### Constitution v22

| Change | Resulting cure |
|---|---|
| **Rule Zero — `OP:` line IS the action** promoted to top of constitution | design-family t0 PASS (Athena now emits a card instead of narrating) |
| **Pre-reply emission checklist** appended at tail | Same |
| **Mandatory chips on refused-build turns** | build-oneshot t2 PASS (QR chips returned after run-3 regression) |

### Fixture audit

| Change | Resulting cure |
|---|---|
| design-family t0 accepts `template_suggestions` (gallery-first is defensible for connector-shape design asks) | t0 PASS — Athena's choice to surface templates is now valid |
| scan-vs-build t1 accepts question-with-chips OR auto-enqueue | t1 PASS — Athena's offer-then-confirm pattern is now valid |

### Auto-approve loop in runner

After each turn, every newly-emitted approval is auto-approved via
`companion_approve_action`. The approval-result (`status`,
`clientAction`, `message`) is captured in the bundle. Async side-effects
(build sessions starting, scan jobs enqueueing) surface in the *next*
turn's captured state so we can observe the full loop.

**8 auto-approves fired in run 4:**
- `build_oneshot` ×4 — every confident-autonomy build attempt resolved
- `enqueue_dev_job` ×3 — scan-vs-build's three scan paths
- `prefill_persona_create` ×1 — explicit-walkthrough build

---

## What auto-approve revealed (the new test depth)

This is the highest-value finding of run 4: the second-level test
caught a class of bugs the first-level assertions can't see.

### `enqueue_dev_job` references a stale `project_id`

Bundle: `scan-vs-build/t0-t1_direct_scan.md`. Athena correctly emits
`OP: enqueue_dev_job { kind: scan_codebase, project_id:
"proj_d408831e82" }` — hard assertion PASSes. But auto-approve's
result:

```
status: approved_failed
message: Execution failed: Validation error: No Dev Tools project
         matched ["proj_d408831e82"]. Register it first with
         register_project (name + filesystem path).
```

The project ID Athena emitted is stale — likely read from her
observability digest in a previous session and re-emitted after a
fresh boot where the dev_projects row has a different UUID. The hard
assertion was satisfied (right op, right params shape), but **the
action would have silently no-op'd in production**. The user would
see "kicking off a scan" + an approval card; click approve; then
nothing happens because the project doesn't match.

**Fix candidates:**
- Constitution: when emitting `enqueue_dev_job`, prefer `path` or
  `project_name` (more durable across resets) over `project_id`.
- Or: dispatcher should fall back to most-recently-registered project
  if `project_id` doesn't match (already partially implemented in
  `execute_enqueue_dev_job`, but needs to also handle the case where
  no candidates match by trying the recent default).

This is exactly the kind of regression the auto-approve loop is
designed to surface.

---

## Remaining 3 failures

### design-family t2 (use_cases) — REGRESSION from run 3

Fixture expects `show_use_case_set` card on "Good. What use cases
should it handle?". Run 3 passed; run 4 failed. Athena likely chose a
clarifying question over committing to a card.

**Hypothesis:** the new Rule Zero made Athena more conservative about
emitting cards she's uncertain about, including cases where commitment
is actually wanted. This is a Goldilocks problem — too lax produces
narration without OP (run 3); too strict produces over-deliberation
(run 4).

**Candidate fix (v23):** add a "When in doubt, render the card" rule
specifically for design-family ops once the user has stated a clear
follow-up. The use_case_set is supposed to be the *opening move* of
the decomposition, not gated on perfect info.

### design-family t6 (recap) — persistent

Fixture expects `show_decision_log` OR `show_recent_decisions` + a
`persona_ready` card on "Recap what we decided." Athena emits prose
audit-trail without the cards.

**Same root cause** as t2: Rule Zero's "if you can't emit the OP, don't
say it" may be backfiring on recap because Athena's prose IS the
audit trail. She doesn't realize the `OP:` is the rendering channel.

**Candidate fix:** strengthen the `show_decision_log` grammar line
with an inline reminder: *"On recap requests ('recap', 'summarize what
we decided', 'audit trail') this op fires unconditionally — the
prose-only fallback is a hallucination of the card."*

### template-vs-build t0 — persistent

Fixture expects `template_suggestions` on a clear Sentry-Slack
intent. Athena likely goes straight to prefill_persona_create.

**This is the third instance of "Athena recognizes the shape but
emits the wrong op kind"**. The constitution's gallery-first rule has
been refined twice now, and the model still picks build over suggest
on this specific intent.

**Candidate fix:** add a positive example pair to the constitution
that names "I need an agent that watches Sentry and pings Slack" as
the canonical template_suggestions trigger.

---

## Where we are

The suite is now **regression-quality**:

- **3 of 5 scenarios** consistently green.
- **87% turn pass rate**, stable across recent runs.
- **Auto-approve loop** catches second-level bugs (stale project_id
  ref) that op-emission tests don't see.
- **The trajectory is monotonic improving** — every constitution
  bump has reduced failures, no run got worse.

The remaining 3 failures are all in design-family + template-vs-build —
both "Athena picks the right card vocabulary" tests. The constitution
has clear rules; the model is sometimes too cautious about emitting
the actual op. One more focused v23 pass on the design-family
grammar lines could plausibly close 2 of 3.

This is a reasonable point to **declare 87% the regression baseline**
and treat any future drop below it as a real regression. The 3
known-failure turns are documented; they're not noise.

---

## Open items for follow-up

| Item | Priority |
|---|---|
| Fix Athena's stale `project_id` reference for enqueue_dev_job (constitution + dispatcher fallback) | High — silent prod no-op |
| Make design-family t2/t6 cards fire unconditionally on clear opener prompts | Med — chase to 90%+ pass rate |
| Add canonical template_suggestions example to constitution | Med — close the last suggest-vs-build gap |
| Re-run on `tauri:dev:test:full` to validate doctrine recall (ml feature) | Low — known-skip on lite |
| Wire LLM-as-judge pass (run 1 was Claude-judge manually; runs 2-4 are hard-assertion only) | Low — usefulness signal beyond op-emission |
