# Athena Quality Bundle — `scan-vs-build` / turn `t1_direct_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 1 of 4
- Hard-assertion status: **PASS**
- Wall time: 18103ms

## User said

```
Scan the personas repo for bugs and tests.
```

## Athena's reply

```
Kicking off a fresh context scan on the Personas repo now — it'll map the structure into business-domain groups + per-feature contexts in the background, and I'll report back when it lands. That scan itself doesn't hunt bugs or read tests directly; it produces the map your **SDLC team's Code Reviewer / QA personas** consume to do that review. So: scan first, then point those two at the refreshed context.

Heads up — the last scan was on May 5th (21,843 files, 1,542 TODO/FIXME markers), so a refresh is overdue anyway.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `enqueue_dev_job`
  - `enqueue_dev_job` params: `{"kind": "scan_codebase", "path": "C:\\Users\\kazda\\kiro\\personas", "project_name": "Personas"}`
- **quick_replies** (3): ['Run Code Reviewer once the scan finishes', 'Run QA persona on the new map', 'Show me what the last scan found']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 1

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `enqueue_dev_job` — status: `approved`, clientAction: `(none)` — Context scan started for `personas` (`C:\Users\kazda\kiro\personas`) (note: requested ["C:\\Users\\kazda\\kiro\\personas"] didn't match any …

## Hard assertions

- ✅ `expect_approval[enqueue_dev_job]` — actions seen: ['enqueue_dev_job']
- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_navigation[personas]` — turn_summary.navigations=0 (route-level forbid is soft — we can only count total navigations)
- ✅ `recall_includes_doctrine_any` — SKIPPED — lite build, doctrine retrieval gated behind `ml` feature. Set ATHENA_SUITE_HAS_ML=1 + run against `tauri:dev:test:full`.
- ✅ `approvals_executed_clean`

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"scan/map/analyze repo"_ → enqueue_dev_job{scan_codebase} + SDLC team Code-Reviewer/QA personas
- _"build autonomous agent"_ → build_oneshot
- _"review code / find bugs / run tests"_ → SDLC team personas — Code Reviewer, QA — not Athena directly

**Anti-patterns to flag explicitly:**
- Replied with build_oneshot for a scan request
- Claimed she will 'review the code' or 'run tests' herself instead of routing to the SDLC team
- Mentioned scanning a service that isn't a wired connector
- Omitted the SDLC team handoff entirely

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/scan-vs-build/t0-t1_direct_scan.json

matching the schema in the playbook §"Verdict file format".
