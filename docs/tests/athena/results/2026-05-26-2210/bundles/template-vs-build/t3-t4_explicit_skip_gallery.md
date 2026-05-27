# Athena Quality Bundle — `template-vs-build` / turn `t4_explicit_skip_gallery`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 17255ms

## User said

```
Forget the gallery, just build a Sentry-to-Slack agent for me from scratch.
```

## Athena's reply

```
On it — building autonomously with the defaults from the walkthrough (fatal + error, 5-min cadence, Haiku). I'll surface what lands or what blocked it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch a Sentry project and post to Slack when new critical issues land. Triggers: scheduled poll every 5 minutes. On each poll, fetch issues created since the last successful run, filtered to level=fatal or level=error. For each new issue, post one Slack message containing issue title, environment, error count + user count, first-seen timestamp, top stack frame, and a Sentry permalink. Skip regressions of previously-resolved issues unless severity is fatal. Track last-seen issue IDs to avoid duplicates across runs. If multiple Sentry projects are connected, default to the first; if multiple Slack channels are available, default to a DM to the user. Tools: Sentry connector (list_issues), Slack connector (post_message). Model tier: Haiku — structured I/O, no synthesis needed. Error handling: Sentry API timeout, Slack 5xx, or missing credentials escalate to manual_reviews with the failing context. Success metric: count_by_status, target ~288 successful runs/day with near-zero failures.", "name": "Sentry Critical → Slack"}`
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

    docs/tests/athena/results/2026-05-26-2210/verdicts/template-vs-build/t3-t4_explicit_skip_gallery.json

matching the schema in the playbook §"Verdict file format".
