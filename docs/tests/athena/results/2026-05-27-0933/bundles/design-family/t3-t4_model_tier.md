# Athena Quality Bundle — `design-family` / turn `t4_model_tier`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 4 of 6
- Hard-assertion status: **PASS**
- Wall time: 28011ms

## User said

```
Which model should it use?
```

## Athena's reply

```
Haiku is the right call here — the work is classification + filling canned templates + light tone detection, which is exactly Haiku's sweet spot. Sonnet only earns its keep if you decide the persona should actually *compose* nuanced replies from scratch rather than fill templates.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `model_tier_choice`

  Card config keys:
  - `model_tier_choice` — keys: ['intent', 'recommended', 'tiers']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Go with Haiku', 'Sonnet — I want real drafted replies', 'Start on Haiku, upgrade if quality drops', "What's the cost difference at my volume?"]
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 7

## Hard assertions

- ✅ `expect_card[model_tier_choice]` — card kinds seen: ['model_tier_choice']

## Judge rubric (this turn)

**Axes to score:** useful, grounded

**Surface map:**
- _"which model?"_ → show_model_tier_choice with the three tiers and a doctrine-grounded recommendation

**Anti-patterns to flag explicitly:**
- Recommended a tier without a rationale
- Rationale doesn't match the doctrine heuristic for this intent shape

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/design-family/t3-t4_model_tier.json

matching the schema in the playbook §"Verdict file format".
