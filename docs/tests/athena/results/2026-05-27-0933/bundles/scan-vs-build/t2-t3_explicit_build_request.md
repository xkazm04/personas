# Athena Quality Bundle — `scan-vs-build` / turn `t3_explicit_build_request`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 26614ms

## User said

```
Build me an autonomous agent that reviews my PRs daily.
```

## Athena's reply

```
Building it autonomously now. The intent is narrow and routine (daily cadence, single source, single output), GitHub is already wired, so one-shot is the right call here.

You'll see the new persona appear in your roster and a read-only Glyph view you can navigate to while it builds. When the build finishes — or if it hits something it can't resolve unattended — you'll get an OS notification plus a bell entry in the app. Chat stays usable in the meantime.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Autonomous agent that reviews my open GitHub pull requests on a daily schedule. Each day, fetch all open PRs across my repositories, review each one for code quality, correctness, common bug patterns, test coverage gaps, and stylistic issues, and produce a consolidated digest with per-PR findings ranked by severity. Surface critical findings as human reviews; deliver the daily digest as a message.", "name": "Daily PR Reviewer"}`
- **quick_replies** (4): ['Make it interactive instead so I can tune it', 'Open the wizard — I want to see the questions', 'Also send the digest to Slack', 'Run it weekly instead of daily']
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

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `build_oneshot` — status: `approved`, clientAction: `navigate` — Building autonomously now — I'll let you know when it's ready (or surface what blocked it). Opening Personas so you can watch.

## Hard assertions

- ✅ `expect_approvals_any` — wanted any of: ['build_oneshot', 'prefill_persona_create']; got: ['build_oneshot']
- ✅ `forbid_approval[enqueue_dev_job]`

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness, no_hallucinated_capabilities

**Surface map:**
- _"build an autonomous agent that..."_ → build_oneshot or prefill_persona_create — NOT a scan job

**Anti-patterns to flag explicitly:**
- Over-corrected to enqueue_dev_job/scan_codebase from prior turns
- Asked for clarification on an already-clear build intent
- Promised behaviors outside what the user described

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/scan-vs-build/t2-t3_explicit_build_request.json

matching the schema in the playbook §"Verdict file format".
