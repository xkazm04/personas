# Athena Quality Bundle — `scan-vs-build` / turn `t4_ambiguous`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 26356ms

## User said

```
I want something that watches my repo for issues.
```

## Athena's reply

```
"Issues" lands in a few different places — want to nail down which one before I prefill another build (especially since the Daily PR Reviewer is still in motion; could be one agent or two):

- **GitHub Issues** (the tracker) — triage incoming issues, label, summarize, maybe draft a first response.
- **CI / build health** — watches for failed builds, broken `main`, flaky tests; pings you when something red lands.
- **Dependency & security** — Dependabot alerts, CVEs in your lockfiles, secret scanning hits.
- **Code-quality drift** — new TODOs, complexity creep, untested code paths landing.

Which flavor — or is it really the same agent as the PR reviewer with a wider net?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Triage GitHub Issues', 'Watch CI / build health', 'Dependency & security alerts', 'Merge it into the PR Reviewer']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 7

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_approval[enqueue_dev_job]`
- ✅ `quick_replies_min[2]` — got 4 chips: ['Triage GitHub Issues', 'Watch CI / build health', 'Dependency & security alerts', 'Merge it into the PR Reviewer']

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

    docs/tests/athena/results/2026-05-26-2210/verdicts/scan-vs-build/t3-t4_ambiguous.json

matching the schema in the playbook §"Verdict file format".
