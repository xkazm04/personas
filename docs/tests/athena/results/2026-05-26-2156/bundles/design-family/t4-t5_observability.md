# Athena Quality Bundle — `design-family` / turn `t5_observability`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 5 of 6
- Hard-assertion status: **FAIL**
- Wall time: 42443ms

## User said

```
How will I know if it's working?
```

## Athena's reply

```
Three things to watch — one tells you it's running, one tells you it's *correctly* running, one tells you when the operator needs to step in.


The metric that pays off most is the **`unknown` rate**, not the throughput. Throughput tells you it's running — Personas already shows you that. The `unknown` rate tells you whether the persona has actually *learned* your inbox: when it's high, your categories don't match the real mail shape; when it's near zero but you're seeing miscategorized items, the persona is being overconfident and you need to tighten the "flag, don't guess" instruction.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `observability_plan`

  Card config keys:
  - `observability_plan` — keys: ['error_handling', 'intent', 'success_metric']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ["Looks right — let's lock the design and build", 'Add cost-per-run as a second metric', 'Show me the decision log so far', 'I want to tweak the unknown-rate target']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 9

## Hard assertions

- ❌ `expect_card[observability_plan]` — card kinds seen: ['observability_plan']

## Judge rubric (this turn)

**Axes to score:** useful, grounded

**Surface map:**
- _"how to know it's working?"_ → show_observability_plan with both error_handling + success_metric populated

**Anti-patterns to flag explicitly:**
- success_metric.target left vague ('high', 'low') instead of a concrete number
- error_handling section empty
- Returned observability in prose instead of the card

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2156/verdicts/design-family/t4-t5_observability.json

matching the schema in the playbook §"Verdict file format".
