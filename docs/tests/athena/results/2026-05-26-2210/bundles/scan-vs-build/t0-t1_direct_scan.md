# Athena Quality Bundle — `scan-vs-build` / turn `t1_direct_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 1 of 4
- Hard-assertion status: **FAIL**
- Wall time: 22532ms

## User said

```
Scan the personas repo for bugs and tests.
```

## Athena's reply

```
Kicking off a context re-scan on `Personas` (`proj_d408831e82`) — last mapped 2026-05-05, so it's about three weeks stale. Runs in the background; I'll surface the result when it lands.

Worth flagging: the context scan maps **structure** (groups, contexts, feature boundaries) — it doesn't itself hunt bugs or read tests. For the actual bug-and-test review, that's your **SDLC team's Code Reviewer / QA** territory. Want me to hand them the scan output once it lands, or do you want to drive that yourself?

OP: {"op": "propose_action", "action": "use_connector", "params": {"connector_name": "dev_tools", "capability": "enqueue_dev_job", "args": {"kind": "scan_codebase", "project_id": "proj_d408831e82"}}, "rationale": "Re-scan Personas — last context map is ~3 weeks old; refreshes the group/context structure before any bug/test review."}

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Hand the scan to the SDLC team when it lands', "Also scan the other 'personas' entry", 'Show me what the SDLC team can do', 'Just ping me when the scan finishes']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 1

## Hard assertions

- ❌ `expect_approval[enqueue_dev_job]` — actions seen: []
- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_navigation[personas]` — turn_summary.navigations=0 (route-level forbid is soft — we can only count total navigations)
- ❌ `recall_includes_doctrine_any` — wanted any of: ['athena-usecases', 'dev-tools', 'templates/08-team-presets']; got titles: []

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

    docs/tests/athena/results/2026-05-26-2210/verdicts/scan-vs-build/t0-t1_direct_scan.json

matching the schema in the playbook §"Verdict file format".
