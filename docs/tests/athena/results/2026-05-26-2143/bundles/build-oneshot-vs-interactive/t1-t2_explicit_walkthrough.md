# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t2_explicit_walkthrough`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 2 of 4
- Hard-assertion status: **FAIL**
- Wall time: 40022ms

## User said

```
I want an agent that watches Sentry. Walk me through what you'd build.
```

## Athena's reply

```
That's the shape. Tell me what to flip — destination channel, severity threshold, polling vs. webhooks, or the regression/resurfaced framings — and I'll one-shot it once you're happy.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `persona_walkthrough`

  Card config keys:
  - `persona_walkthrough` — keys: ['content', 'intent']
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch Sentry for new critical-severity issues and post each one to the #alerts Slack channel. Trigger: poll Sentry on a short cadence (every few minutes) for newly-created issues at level=fatal/error with is_unresolved=true. For each new critical issue, send a Slack message to #alerts containing the issue title, project, environment, error count, first/last seen, and a link back to the Sentry issue. Dedupe so a given Sentry issue is only posted once. Use the existing Sentry and Slack connectors.", "name": "Sentry Critical Alerts To Slack"}`
- **quick_replies** (4): ['Build it as-is', 'Add webhooks instead of polling', 'Drop regression and resurfaced buckets', 'Send to a different Slack channel']
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

- ❌ `forbid_approval[build_oneshot]` — unexpected: [{'id': 'appr_80c71680b5', 'action': 'build_oneshot', 'rationale': 'Narrow, routine monitor with existing connectors and a clear one-shape output — fits build_oneshot; Michal asked me to decide and report back.', 'paramsJson': '{"intent":"Watch Sentry for new critical-severity issues and post each one to the #alerts Slack channel. Trigger: poll Sentry on a short cadence (every few minutes) for newly-created issues at level=fatal/error with is_unresolved=true. For each new critical issue, send a Slack message to #alerts containing the issue title, project, environment, error count, first/last seen, and a link back to the Sentry issue. Dedupe so a given Sentry issue is only posted once. Use the existing Sentry and Slack connectors.","name":"Sentry Critical Alerts To Slack"}', 'humanReviewId': None, 'createdAt': '2026-05-26 21:44:01'}]
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

    docs/tests/athena/results/2026-05-26-2143/verdicts/build-oneshot-vs-interactive/t1-t2_explicit_walkthrough.json

matching the schema in the playbook §"Verdict file format".
