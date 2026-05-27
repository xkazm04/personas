# Athena Quality Bundle — `scan-vs-build` / turn `t4_ambiguous`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 26302ms

## User said

```
I want something that watches my repo for issues.
```

## Athena's reply

```
"Issues" could go two ways and the right template depends on which:

- **GitHub Issues (the tracker)** — triage new issues as they're filed, classify them, flag the critical ones. GitHub connector is wired, this is a routine shape.
- **Code health / problems** — failing CI, dependency vulnerabilities, security alerts, things going wrong in the repo itself. Different connector mix.

Which flavor are you after? Or is this meant to replace the PR-review idea from a minute ago, not add to it?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Triage new GitHub Issues', 'Watch for code-health problems', 'Both — one agent that does it all', 'Replace the PR-review idea with this']
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
- ✅ `quick_replies_min[2]` — got 4 chips: ['Triage new GitHub Issues', 'Watch for code-health problems', 'Both — one agent that does it all', 'Replace the PR-review idea with this']

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

    docs/tests/athena/results/2026-05-27-0859/verdicts/scan-vs-build/t3-t4_ambiguous.json

matching the schema in the playbook §"Verdict file format".
