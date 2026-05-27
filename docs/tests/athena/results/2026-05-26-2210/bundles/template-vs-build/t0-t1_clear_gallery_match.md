# Athena Quality Bundle — `template-vs-build` / turn `t1_clear_gallery_match`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 1 of 4
- Hard-assertion status: **FAIL**
- Wall time: 19532ms

## User said

```
I need an agent that watches my Sentry project and pings me in Slack when new critical issues land.
```

## Athena's reply

```
Straightforward build — Sentry watcher → Slack ping on new critical issues. A few choices want answers before launch: which Sentry project, what counts as "critical" (level=fatal, level=error, or first-seen + tagged), which Slack channel, and poll cadence. I'll drop you into the build flow with your intent prefilled so you can settle those.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `prefill_persona_create`
  - `prefill_persona_create` params: `{"auto_launch": false, "intent": "Watch my Sentry project for new critical issues and post to Slack when they land. Triggers: new issues at level=fatal or level=error, first-seen (not regressions of resolved issues unless severity is fatal). Output: Slack message with issue title, project, environment, count, and a link back to Sentry. Polling cadence: every 5 minutes.", "mode": "interactive", "name": "Sentry Critical → Slack"}`
- **quick_replies** (4): ['Just one-shot it, you decide', 'Open the wizard so I can tune it', 'Use level=fatal only', 'Poll every 15 min instead']
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

- ✅ `forbid_approval[build_oneshot]`
- ❌ `forbid_approval[prefill_persona_create]` — unexpected: [{'id': 'appr_63f3a52f50', 'action': 'prefill_persona_create', 'rationale': 'Intent is clear but the channel, severity threshold, and cadence deserve your input before launch — opening the wizard prefilled so you can confirm.', 'paramsJson': '{"auto_launch":false,"intent":"Watch my Sentry project for new critical issues and post to Slack when they land. Triggers: new issues at level=fatal or level=error, first-seen (not regressions of resolved issues unless severity is fatal). Output: Slack message with issue title, project, environment, count, and a link back to Sentry. Polling cadence: every 5 minutes.","mode":"interactive","name":"Sentry Critical → Slack"}', 'humanReviewId': None, 'createdAt': '2026-05-26 22:14:22'}]
- ❌ `expect_card[template_suggestions]` — card kinds seen: []
- ✅ `quick_replies_min[1]` — got 4 chips: ['Just one-shot it, you decide', 'Open the wizard so I can tune it', 'Use level=fatal only', 'Poll every 15 min instead']

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"intent matches gallery template"_ → show_template_suggestions — adoption preserves customization flow
- _"named templates"_ → companion_match_templates result — NOT training-data guesses

**Anti-patterns to flag explicitly:**
- Emitted prefill_persona_create despite a clear gallery match
- Surfaced both template_suggestions AND prefill on the same turn
- Described a template with features not in its match-result snippet

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2210/verdicts/template-vs-build/t0-t1_clear_gallery_match.json

matching the schema in the playbook §"Verdict file format".
