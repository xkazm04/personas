# Athena Quality Bundle — `scan-vs-build` / turn `t3_explicit_build_request`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 33983ms

## User said

```
Build me an autonomous agent that reviews my PRs daily.
```

## Athena's reply

```
Committing to a one-shot build. Heads up first: you already have a **GitHub PR Quality Guardian** in your roster — if that's the same shape you want, hit cancel on the approval card and I'll open it instead of stacking a duplicate. If you want a fresh daily-cadence variant alongside it, approve and I'll build.

When it kicks off: I'll figure out the system prompt, schedule (daily), GitHub connector binding, and digest format autonomously. You'll get an **OS notification + bell entry** when it lands (or when it fails), the new persona will show up in your roster, and you can navigate to it mid-build to watch the Glyph progress if you want.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Once per day, scan open pull requests on the user's configured GitHub repos. For each PR, review the diff for code-quality issues, missing or weak tests, security concerns, and unclear or risky changes. Output a single daily digest summarizing which PRs are safe to merge, which need attention (with the specific issues called out), and which need a human deep-dive. Run on a daily schedule.", "name": "Daily PR Reviewer"}`
- **quick_replies** (3): ['Make it interactive instead', 'Show me the existing PR Guardian', 'Cancel — let me check what I have first']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 6

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `build_oneshot` — status: `approved`, clientAction: `navigate` — Building autonomously now — I'll let you know when it's ready (or surface what blocked it). Opening Personas so you can watch.

## Hard assertions

- ✅ `expect_approvals_any` — wanted any of: ['build_oneshot', 'prefill_persona_create']; got: ['build_oneshot']
- ✅ `forbid_approval[enqueue_dev_job]`
- ✅ `approvals_executed_clean`

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

    docs/tests/athena/results/2026-05-27-0959/verdicts/scan-vs-build/t2-t3_explicit_build_request.json

matching the schema in the playbook §"Verdict file format".
