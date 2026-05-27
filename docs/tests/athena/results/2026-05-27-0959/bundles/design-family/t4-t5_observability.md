# Athena Quality Bundle — `design-family` / turn `t5_observability`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 5 of 6
- Hard-assertion status: **PASS**
- Wall time: 27776ms

## User said

```
How will I know if it's working?
```

## Athena's reply

```
Triage personas tend to fail silently — wrong label, missed escalation, off-tone draft — so the metric you want is *decision quality*, not just "did the run complete." Pair that with a sharp escalation path for the cases the persona itself isn't confident on.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `observability_plan`

  Card config keys:
  - `observability_plan` — keys: ['error_handling', 'intent', 'success_metric']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Looks good — give me the recap', 'Add: latency target per email', 'Use draft-acceptance rate instead', 'Skip auto-draft, route-only to start']
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

    docs/tests/athena/results/2026-05-27-0959/verdicts/design-family/t4-t5_observability.json

matching the schema in the playbook §"Verdict file format".
