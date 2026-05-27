# Athena Quality Bundle — `design-family` / turn `t4_model_tier`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 4 of 6
- Hard-assertion status: **PASS**
- Wall time: 31074ms

## User said

```
Which model should it use?
```

## Athena's reply

```
Triage is classification with a structured output — that's Haiku's sweet spot. Save Sonnet for when you actually need the persona to *reason* about the email, not just bucket it.


One thing to watch: if you see the persona confidently mis-bucketing ambiguous emails (instead of flagging them as `unknown`), that's almost never a model-tier problem — it's a system-prompt problem. Tighten the "when uncertain, flag don't guess" instruction before reaching for Sonnet.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `model_tier_choice`

  Card config keys:
  - `model_tier_choice` — keys: ['intent', 'recommended', 'tiers']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Go with Haiku', 'Upgrade to Sonnet — I want VIP routing later', 'Skip ahead and one-shot the build', 'Show me the observability plan next']
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

    docs/tests/athena/results/2026-05-26-2156/verdicts/design-family/t3-t4_model_tier.json

matching the schema in the playbook §"Verdict file format".
