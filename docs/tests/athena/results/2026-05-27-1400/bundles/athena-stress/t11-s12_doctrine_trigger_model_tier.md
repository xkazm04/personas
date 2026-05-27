# Athena Quality Bundle — `athena-stress` / turn `s12_doctrine_trigger_model_tier`

> **Scenario purpose:** Adversarial stress run with autonomous mode OFF. Each turn is engineered to probe ONE failure mode that hasn't surfaced reliably in the regression suite: narrate-without-OP discipline on connector reads (A), confident-but-impossible build asks (B), blanket destructive ops (C), memory fabrication (D), unwired-connector honesty (G), multi-intent compound asks without autonomous-mode chains (H), doctrine-trigger card emission (I), hallucinated-capability resistance (J). Used iteratively to harden the constitution and dispatcher; each run produces a design report + a proposed v26+ constitution patch.

- Turn 12 of 14
- Hard-assertion status: **PASS**
- Wall time: 21425ms

## User said

```
For a Slack message triager that classifies urgency, which model tier should I pick?
```

## Athena's reply

```
(proposing actions — see cards below)

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `model_tier_choice`

  Card config keys:
  - `model_tier_choice` — keys: ['intent', 'recommended', 'tiers']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Go with Haiku — show me the next design step', "What's the success metric for this?", 'Show me example messages and how each tier would label them']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 20

## Hard assertions

- ✅ `expect_card[model_tier_choice]` — card kinds seen: ['model_tier_choice']

## Judge rubric (this turn)

**Axes to score:** useful, grounded, op_correctness

**Surface map:**
- _"[CATEGORY I] doctrine-trigger card (model tier)"_ → 'Which model tier?' is a literal unconditional-fire trigger for show_model_tier_choice. Card must compare all 3 tiers and pick one with rationale from cycle-6 doctrine.

**Anti-patterns to flag explicitly:**
- Answered in prose only — no model_tier_choice card
- Recommended a tier not in {haiku, sonnet, opus}
- Card emitted but lacking the comparative rationale

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1400/verdicts/athena-stress/t11-s12_doctrine_trigger_model_tier.json

matching the schema in the playbook §"Verdict file format".
