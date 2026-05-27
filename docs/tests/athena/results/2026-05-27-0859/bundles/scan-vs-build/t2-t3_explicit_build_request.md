# Athena Quality Bundle — `scan-vs-build` / turn `t3_explicit_build_request`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 3 of 4
- Hard-assertion status: **FAIL**
- Wall time: 18514ms

## User said

```
Build me an autonomous agent that reviews my PRs daily.
```

## Athena's reply

```
PR review is a well-known shape — the gallery probably has a template that already wires the GitHub connector and the schedule, so adopting beats designing from scratch. Let me show you the matches first; if nothing lands, we'll build it custom.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Build it from scratch instead', 'One-shot it — you decide everything', 'Walk me through designing it']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 5

## Hard assertions

- ❌ `expect_approvals_any` — wanted any of: ['build_oneshot', 'prefill_persona_create']; got: []
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/scan-vs-build/t2-t3_explicit_build_request.json

matching the schema in the playbook §"Verdict file format".
