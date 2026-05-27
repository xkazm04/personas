# Athena Quality Bundle — `scan-vs-build` / turn `t1_direct_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 1 of 4
- Hard-assertion status: **PASS**
- Wall time: 22899ms

## User said

```
Scan the personas repo for bugs and tests.
```

## Athena's reply

```
Two things worth separating here:

**The scan itself maps structure, not bugs.** A context scan reads the repo into domain groups + feature contexts — it's what your SDLC team's Code Reviewer and QA personas *consume* to do the actual bug/test hunt. The last scan on `proj_d408831e82` was 2026-05-05, three weeks stale, so a refresh is the right starting move.

**You also have a duplicate registry entry** — `proj_3fe3bc88d4` (`C:/Users/kazda/kiro/personas`, never scanned) looks like a path-case dupe of the real one at `C:\Users\kazda\kiro\personas`. Worth cleaning up, but not blocking.

Kicking off the refresh now on the canonical project — it runs in the background, I'll see the result on a later turn and report back. For the actual bug-and-test review, the SDLC team's Code Reviewer / QA personas are the right tool once the map is fresh.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `enqueue_dev_job`
  - `enqueue_dev_job` params: `{"kind": "scan_codebase", "project_id": "proj_d408831e82"}`
- **quick_replies** (3): ['Assign the SDLC team to review for bugs', 'Assign the SDLC team to audit test coverage', 'Clean up the duplicate project entry']
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/scan-vs-build/t0-t1_direct_scan.json

matching the schema in the playbook §"Verdict file format".
