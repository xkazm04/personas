# Athena Quality Bundle — `template-vs-build` / turn `t4_explicit_skip_gallery`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 26890ms

## User said

```
Forget the gallery, just build a Sentry-to-Slack agent for me from scratch.
```

## Athena's reply

```
Building it. The build session will pick the Sentry project + Slack channel from your wired connectors, set up a 5-min cron poll, dedupe via local state, and ship on Haiku. You'll get an OS notification + bell entry when it lands (or surfaces what blocked it); the new persona will show up in your roster, and you can navigate to it to watch the Glyph progress while it builds.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch a Sentry project for new fatal/error-level issues every 5 minutes. Dedupe against issues already announced (local KV state of sentry_issue_ids + last-poll timestamp). For each new critical issue, post one compact Slack message containing: title, project, error type, event count, affected users, direct Sentry link. Batch multiple criticals in the same polling window into a single message with bulleted entries. Stay silent when nothing qualifies — no 'all clear' noise. Skip resolved or ignored issues. On Sentry auth failure or Slack 4xx, escalate to Human Review. Use Haiku — filter + format work, no reasoning needed.", "name": "Sentry Critical → Slack"}`
- **quick_replies** (3): ['Make it interactive instead', "Walk me through what it built when it's done", 'Build a second one for warning-level issues too']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 7

## Hard assertions

- ✅ `expect_approvals_any` — wanted any of: ['prefill_persona_create', 'build_oneshot']; got: ['build_oneshot']

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness

**Surface map:**
- _"explicit 'skip gallery, build directly'"_ → prefill_persona_create or build_oneshot — do NOT re-litigate

**Anti-patterns to flag explicitly:**
- Pushed template adoption again despite explicit override
- Asked 'are you sure?' after the user committed

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0913/verdicts/template-vs-build/t3-t4_explicit_skip_gallery.json

matching the schema in the playbook §"Verdict file format".
