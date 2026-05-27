# Athena Quality Bundle — `template-vs-build` / turn `t4_explicit_skip_gallery`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 21797ms

## User said

```
Forget the gallery, just build a Sentry-to-Slack agent for me from scratch.
```

## Athena's reply

```
Building. Both Sentry and Slack are wired, so the connector binding should slot in cleanly. I'll let the build session pick the polling cadence, severity filter (likely `level:error` or `level:fatal`), and dedupe shape — you'll get an OS notification + bell entry when it's ready (or a failure surface if something blocks). The new persona will land in the roster; you can navigate to it mid-build to watch the Glyph progress if you want, but the chat panel stays free.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch a Sentry project for new critical-level issues (level:error and level:fatal, first-seen only — not regressions) and post a concise alert to a Slack channel when they land. Each alert should include the issue title, project, environment, error count, and a direct link to the Sentry issue. Dedupe by issue ID so the same issue doesn't ping twice. Poll on a sensible cadence (every 5-10 minutes).", "name": "Sentry → Slack Critical Watcher"}`
- **quick_replies** (3): ['Make it interactive instead', 'Add a daily digest of unresolved issues too', 'Also alert on regressions, not just new']
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
- ✅ `approvals_executed_clean`

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness

**Surface map:**
- _"explicit 'skip gallery, build directly'"_ → prefill_persona_create or build_oneshot — do NOT re-litigate

**Anti-patterns to flag explicitly:**
- Pushed template adoption again despite explicit override
- Asked 'are you sure?' after the user committed

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/template-vs-build/t3-t4_explicit_skip_gallery.json

matching the schema in the playbook §"Verdict file format".
