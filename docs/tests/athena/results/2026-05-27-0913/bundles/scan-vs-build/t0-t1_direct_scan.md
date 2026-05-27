# Athena Quality Bundle — `scan-vs-build` / turn `t1_direct_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 1 of 4
- Hard-assertion status: **PASS**
- Wall time: 19924ms

## User said

```
Scan the personas repo for bugs and tests.
```

## Athena's reply

```
Quick scope check before I queue: a context scan **maps** the repo into domain groups + per-feature contexts. It doesn't itself hunt bugs or read tests. The actual bug-and-test review is what the SDLC team's **Code Reviewer** and **QA** personas do — they consume the scan output. So the right order is: refresh the scan (last one was 22 days ago on `proj_d408831e82`), then hand it to that team.

Kicking the scan off now — it runs in the background and lands as a system episode when done, so keep talking and I'll surface the result.


One side note: you have two registry entries for the same repo — `proj_d408831e82` (backslash path, scanned) and `proj_3fe3bc88d4` (forward-slash path, never scanned). Want me to drop the duplicate after the scan finishes?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `enqueue_dev_job`
  - `enqueue_dev_job` params: `{"kind": "scan_codebase", "project_id": "proj_d408831e82"}`
- **quick_replies** (3): ['Yes, drop the duplicate project', 'Hand the scan to the SDLC team when it lands', "Show me the SDLC team's roster"]
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

## Hard assertions

- ✅ `expect_approval[enqueue_dev_job]` — actions seen: ['enqueue_dev_job']
- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_navigation[personas]` — turn_summary.navigations=0 (route-level forbid is soft — we can only count total navigations)
- ✅ `recall_includes_doctrine_any` — SKIPPED — lite build, doctrine retrieval gated behind `ml` feature. Set ATHENA_SUITE_HAS_ML=1 + run against `tauri:dev:test:full`.

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

    docs/tests/athena/results/2026-05-27-0913/verdicts/scan-vs-build/t0-t1_direct_scan.json

matching the schema in the playbook §"Verdict file format".
