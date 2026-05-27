# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t1_confident_autonomy`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 1 of 4
- Hard-assertion status: **FAIL**
- Wall time: 14850ms

## User said

```
Just build me an agent that watches Sentry and posts new critical issues to my #alerts Slack channel. Decide everything yourself, I'll review when it's done.
```

## Athena's reply

```
On it — Sentry watcher into `#alerts`, one-shot build. I'll let you know when it's ready (or surface what blocked it).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Monitor Sentry for new critical-severity issues and post each one to the #alerts Slack channel as it appears. Poll Sentry on a short interval (every 5 minutes), filter to level=fatal or level=error with is:unresolved and firstSeen within the polling window, dedupe by issue ID so the same issue is never posted twice. Each Slack message should include the issue title, project, environment, count, and a direct link to the Sentry issue. Skip if no new criticals.", "name": "Sentry Critical → Slack Alerts"}`
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

    docs/tests/athena/results/2026-05-26-2156/verdicts/build-oneshot-vs-interactive/t0-t1_confident_autonomy.json

matching the schema in the playbook §"Verdict file format".
