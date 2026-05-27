# Athena Quality Bundle — `design-family` / turn `t5_observability`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 5 of 6
- Hard-assertion status: **PASS**
- Wall time: 28688ms

## User said

```
How will I know if it's working?
```

## Athena's reply

```
Two layers — failure paths so nothing gets silently dropped, and one north-star metric so you know if it's actually good, not just running.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `observability_plan`

  Card config keys:
  - `observability_plan` — keys: ['error_handling', 'intent', 'success_metric']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['This is enough — show me the build plan', 'Add a metric for response latency', 'What about cost per email?']
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

- ✅ `expect_card[observability_plan]` — card kinds seen: ['observability_plan']

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

    docs/tests/athena/results/2026-05-27-0913/verdicts/design-family/t4-t5_observability.json

matching the schema in the playbook §"Verdict file format".
