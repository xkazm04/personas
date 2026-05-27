# Athena Quality Bundle — `template-vs-build` / turn `t4_explicit_skip_gallery`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 37396ms

## User said

```
Forget the gallery, just build a Sentry-to-Slack agent for me from scratch.
```

## Athena's reply

```
Building autonomously — I'll let you know when it lands (or surface what blocked it). You'll see an OS notification + a bell entry when it finishes, and the new persona will appear in your roster. If you want to watch the build progress, navigate to it and the Glyph view will play out; the chat stays usable here.

One thing the one-shot will guess: **which** Sentry project + **which** Slack channel. If you've got more than one of either, you may want to tune those after — or take the off-ramp now.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch my Sentry project for new unresolved critical issues and post a formatted Slack message per issue when they appear. Dedupe by issue fingerprint so the same issue isn't pinged twice within 24h. Scheduled poll every 10 minutes. Stay silent when there's nothing new. On API/post failure, write a Human Review with the unposted issues. Haiku tier — this is filter + format, not interpretation.", "name": "Sentry Critical Watcher"}`
- **quick_replies** (3): ['Open the wizard so I can tune it', 'Use a specific Sentry project — let me name it', 'Use a specific Slack channel — let me name it']
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/template-vs-build/t3-t4_explicit_skip_gallery.json

matching the schema in the playbook §"Verdict file format".
