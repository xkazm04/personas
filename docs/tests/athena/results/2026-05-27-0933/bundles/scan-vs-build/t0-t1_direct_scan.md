# Athena Quality Bundle — `scan-vs-build` / turn `t1_direct_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 1 of 4
- Hard-assertion status: **PASS**
- Wall time: 25358ms

## User said

```
Scan the personas repo for bugs and tests.
```

## Athena's reply

```
Two things to untangle here. First, the context scan itself — I'll re-run it on `Personas` (`proj_d408831e82`); the last scan was 2026-05-05, so the map is three weeks stale. It runs in the background and reports back as a system episode; you don't need to wait on this turn.

Second, the scan **maps structure** — files, domain groups, feature contexts. It does not hunt bugs or evaluate test coverage on its own. That's the **SDLC team's** job: the Code Reviewer persona reads the scan output and surfaces real correctness issues, and the QA persona handles test gaps. Want me to point the SDLC team at the Personas project once the fresh scan lands, or kick them off in parallel against the existing (stale) map?

Also worth flagging: you have two registry entries for the same repo — `Personas` (`proj_d408831e82`, Windows-style path) and `personas` (`proj_3fe3bc88d4`, forward-slash path, never scanned). Probably worth collapsing those before the next scan so we're not maintaining two contexts. Want me to surface that?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `enqueue_dev_job`
  - `enqueue_dev_job` params: `{"kind": "scan_codebase", "project_id": "proj_d408831e82"}`
- **quick_replies** (3): ['Run the SDLC team against Personas now', 'Wait for the scan, then run SDLC team', 'Collapse the duplicate project entries first']
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

- ✅ `enqueue_dev_job` — status: `approved_failed`, clientAction: `(none)` — Execution failed: Validation error: No Dev Tools project matched ["proj_d408831e82"]. Register it first with register_project (name + filesy…

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

    docs/tests/athena/results/2026-05-27-0933/verdicts/scan-vs-build/t0-t1_direct_scan.json

matching the schema in the playbook §"Verdict file format".
