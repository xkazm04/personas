# Athena Quality Bundle — `template-vs-build` / turn `t4_explicit_skip_gallery`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 18168ms

## User said

```
Forget the gallery, just build a Sentry-to-Slack agent for me from scratch.
```

## Athena's reply

```
Got it — building unattended. You'll get an OS notification + bell entry when it lands (or when it surfaces something that blocked it), and the persona will appear in your roster; you can navigate to it mid-build to watch the Glyph progress if you want.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch a configured Sentry project for new issues and post to a Slack channel when one lands at critical severity. Trigger: poll Sentry (or webhook if available). Filter to issues with level=fatal/error at critical-severity threshold, first-seen within the polling window. Slack message includes title, project, environment, link to the issue. Deduplicate so the same issue isn't re-pinged.", "name": "Sentry Critical → Slack"}`
- **quick_replies** (3): ['Make it interactive instead', 'Add a severity-threshold question first', 'Cancel — I want to tweak the intent']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 8

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `build_oneshot` — status: `approved`, clientAction: `navigate` — Building autonomously now — I'll let you know when it's ready (or surface what blocked it). Opening Personas so you can watch.

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

    docs/tests/athena/results/2026-05-27-0933/verdicts/template-vs-build/t3-t4_explicit_skip_gallery.json

matching the schema in the playbook §"Verdict file format".
