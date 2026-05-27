# Athena Quality Bundle — `scan-vs-build` / turn `t3_explicit_build_request`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 38546ms

## User said

```
Build me an autonomous agent that reviews my PRs daily.
```

## Athena's reply

```
Dropping you into the build with the intent prefilled — there are a few choices the questionnaire will want to settle (which repos, comments-on-PR vs daily digest vs both, all PRs or just yours, model tier). Pick interactive so you stay in the loop on those.

One flag: this is separate from your SDLC team's Code Reviewer — that's an on-demand capability you invoke; this would be a scheduled autonomous agent that runs unattended. Both can coexist, but worth being intentional about the split (the new persona for the daily sweep, the team's reviewer for deeper on-demand passes).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `prefill_persona_create`
  - `prefill_persona_create` params: `{"auto_launch": true, "intent": "Autonomous daily PR reviewer — scans my open pull requests across my registered projects once a day, reviews each for correctness, code quality, and test coverage, and reports back (review comments on the PR and/or a daily digest).", "mode": "interactive", "name": "Daily PR Reviewer"}`
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
- **episode_count**: 5

## Hard assertions

- ✅ `expect_approvals_any` — wanted any of: ['build_oneshot', 'prefill_persona_create']; got: ['prefill_persona_create']
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

    docs/tests/athena/results/2026-05-26-2210/verdicts/scan-vs-build/t2-t3_explicit_build_request.json

matching the schema in the playbook §"Verdict file format".
