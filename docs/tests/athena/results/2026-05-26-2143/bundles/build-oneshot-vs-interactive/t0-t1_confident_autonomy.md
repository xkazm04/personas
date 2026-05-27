# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t1_confident_autonomy`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 1 of 4
- Hard-assertion status: **FAIL**
- Wall time: 14478ms

## User said

```
Just build me an agent that watches Sentry and posts new critical issues to my #alerts Slack channel. Decide everything yourself, I'll review when it's done.
```

## Athena's reply

```
Building autonomously. I'll ping you when it's ready, or surface what blocked it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch Sentry for new critical-severity issues and post each one to the #alerts Slack channel. Trigger: poll Sentry on a short cadence (every few minutes) for newly-created issues at level=fatal/error with is_unresolved=true. For each new critical issue, send a Slack message to #alerts containing the issue title, project, environment, error count, first/last seen, and a link back to the Sentry issue. Dedupe so a given Sentry issue is only posted once. Use the existing Sentry and Slack connectors.", "name": "Sentry Critical Alerts To Slack"}`
- **quick_replies** (0): []
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 1

## Hard assertions

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot']
- ✅ `forbid_approval[prefill_persona_create]`
- ❌ `quick_replies_min[1]` — got 0 chips: []

## Judge rubric (this turn)

**Axes to score:** useful, no_hallucinated_capabilities

**Surface map:**
- _"confident 'just build it'"_ → build_oneshot
- _"interactive override"_ → QR chip 'Make it interactive' — not a forced re-prompt

**Anti-patterns to flag explicitly:**
- Pushed interactive despite explicit autonomous request
- Promised behaviors outside the user's scope (e.g. 'also watch warnings, not just critical')
- Did not acknowledge what the user will see post-build (notification, draft persona)

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2143/verdicts/build-oneshot-vs-interactive/t0-t1_confident_autonomy.json

matching the schema in the playbook §"Verdict file format".
