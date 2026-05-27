# Athena Quality Bundle — `scan-vs-build` / turn `t2_euphemistic_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 39712ms

## User said

```
Can you look through my codebase and tell me what's broken?
```

## Athena's reply

```
Heads up: my scan op last turn was **approved but rejected at execution** — the registry shows `proj_d408831e82`, but Dev Tools couldn't find a matching `dev_projects` row, so nothing scanned. We'd need to call `register_project` first to wire it up properly. I'll surface that below.

But I can already tell you what's broken from operational state — I don't need a fresh scan for the top items:

### The signal in your fleet right now

- **Two personas died on the same DB CHECK constraint.** `Sales Deal Intelligence` and `Knowledge Base Health Auditor` both failed with `CHECK constraint failed: status IN ('queued', 'running'…)` — same root cause, different personas. Something in the execution status-persist path is trying to write a value that violates the schema. This is an **engine-layer bug**, not a persona-config issue. Worth pinning down before more agents trip it.
- **Two generic crashes with open healing tickets.** `Document Auto-Translator` and `Demo Recorder (6)` both failed with bare exit code 1, no error context. Both have medium-severity healing events open. These need source-level diagnosis — operational state can't tell you why.
- **Security finding has now sat for 3 consecutive audits.** `AI Environment Posture Audit` keeps flagging `F-2026-05-20-001` — plaintext OAuth tokens outside the OS keyring — and it's been open since 2026-05-20 with two duplicate critical reviews still pending. This is the longest-standing real issue in your queue.

### What I'd do next

For the two exit-code-1 crashes and the CHECK constraint bug, you want the **SDLC team's Code Reviewer** reading actual source — that's the real "what's broken" answer. For that to be useful, I should first register the repo properly with Dev Tools so the scan can run and give the team a fresh map.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `register_project`
  - `register_project` params: `{"description": "Personas Desktop — main repo", "name": "Personas", "path": "C:\\Users\\kazda\\kiro\\personas"}`
- **quick_replies** (4): ['Register + scan, then run SDLC team', 'Skip the scan, send SDLC team in now', 'Triage the CHECK constraint bug first', 'Resolve the security review backlog']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 4

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `register_project` — status: `approved`, clientAction: `(none)` — Project `Personas` is set up — registered in your project list and created as Dev Tools project `b0c1541f-af08-4912-818e-19ca94f7b6e9` so th…

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[1]` — got 4 chips: ['Register + scan, then run SDLC team', 'Skip the scan, send SDLC team in now', 'Triage the CHECK constraint bug first', 'Resolve the security review backlog']

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"look through codebase / find what's broken"_ → Either (a) auto-fire enqueue_dev_job{scan_codebase} for a fresh map, OR (b) answer from operational state (healing events, pending reviews, failed executions) FIRST then offer the scan as a follow-up chip. Both are defensible — the user wants a useful answer about what's broken, not strictly a scan job.
- _"fix bugs"_ → SDLC team review personas — not Athena directly

**Anti-patterns to flag explicitly:**
- Replied with build_oneshot
- Promised to fix bugs directly
- Treated 'look through' as a literal Read of every file in chat

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/scan-vs-build/t1-t2_euphemistic_scan.json

matching the schema in the playbook §"Verdict file format".
