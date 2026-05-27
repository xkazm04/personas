# Athena Quality Bundle — `scan-vs-build` / turn `t4_ambiguous`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 27534ms

## User said

```
I want something that watches my repo for issues.
```

## Athena's reply

```
"Issues" is doing a lot of work in that sentence — let me pull up close matches from the gallery and we can pick a shape. Quick read first though: you already have **Sentry Critical Monitor** running, so if you meant Sentry-style runtime errors, that's covered. The other common shapes for "watches my repo" are GitHub Issues triage, CI/build failure alerts, and code-level regression scanning (which is really the SDLC team's beat, not a new persona).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['GitHub Issues triage — new bugs filed against my repos', 'CI / build failure alerts', 'Code-level regressions — hand off to SDLC team', 'Sentry already covers this, skip']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 10

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_approval[enqueue_dev_job]`
- ✅ `quick_replies_min[2]` — got 4 chips: ['GitHub Issues triage — new bugs filed against my repos', 'CI / build failure alerts', 'Code-level regressions — hand off to SDLC team', 'Sentry already covers this, skip']

## Judge rubric (this turn)

**Axes to score:** useful

**Surface map:**
- _"ambiguous 'watches repo' intent"_ → ONE specific clarifying question with QR chips — not a commit

**Anti-patterns to flag explicitly:**
- Committed to an op despite ambiguity
- Asked three questions in a row instead of one focused one
- Asked a vague 'tell me more' question with no chips

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/scan-vs-build/t3-t4_ambiguous.json

matching the schema in the playbook §"Verdict file format".
