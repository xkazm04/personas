# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t2_explicit_walkthrough`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 39651ms

## User said

```
I want an agent that watches Sentry. Walk me through what you'd build.
```

## Athena's reply

```
(proposing actions — see cards below)

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `persona_walkthrough`

  Card config keys:
  - `persona_walkthrough` — keys: ['content', 'intent']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Slack #alerts, fatal only, all projects — build it', 'Slack #alerts, fatal + spikes, all projects — build it', 'Let me adjust the design first', 'Open the wizard so I can tune everything']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 3

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `expect_card_any` — wanted any of: ['persona_walkthrough']; got: ['persona_walkthrough']

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness

**Surface map:**
- _"explicit 'walk me through'"_ → show_persona_walkthrough or prefill_persona_create{interactive} — never build_oneshot

**Anti-patterns to flag explicitly:**
- Emitted build_oneshot despite explicit walkthrough request
- Walkthrough lacks the seven readiness items

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0913/verdicts/build-oneshot-vs-interactive/t1-t2_explicit_walkthrough.json

matching the schema in the playbook §"Verdict file format".
