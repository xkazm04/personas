# Athena Quality Bundle — `scan-vs-build` / turn `t2_euphemistic_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 2 of 4
- Hard-assertion status: **FAIL**
- Wall time: 26494ms

## User said

```
Can you look through my codebase and tell me what's broken?
```

## Athena's reply

```
Three things stand out from operational state right now — these are concrete and source-level review can wait:

### 1. Recurring critical: plaintext OAuth tokens outside the OS keyring

The AI Environment Posture Audit has flagged `F-2026-05-20-001` for **three consecutive runs**. That's not noise — it's the same finding sitting unresolved while the auditor keeps re-raising it. Real codebase issue: credential storage is bypassing the keyring path somewhere. Worth opening before anything else.

### 2. A status-enum regression hitting two agents

Sales Deal Intelligence and Knowledge Base Health Auditor both failed with the same error:

```
Database error: CHECK constraint failed: status IN ('queued', 'runnin…
```

Same constraint, same truncation point — almost certainly a code path writing a status value that isn't in the schema's allowed set (or a migration that didn't land). Two agents hitting it suggests it's in the shared execution layer, not agent-specific. Worth grepping the executions writer for new status values vs. the migration's CHECK list.

### 3. Two silent failures with no detail

Document Auto-Translator and Demo Recorder (6) both exited 1 with empty messages. Healing has them at medium. They're worth opening individually because exit-1-without-output usually means an unhandled panic or a stderr/stdout routing bug — not the agent logic itself.

The context scan I kicked off last turn is still running. Once it lands, the SDLC team's Code Reviewer can do the source-level pass for #2 and #3 specifically — the CHECK-constraint one is the most tractable from a code-review angle.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Open the OAuth keyring finding', 'Have the SDLC team dig into the status-enum bug', 'Show me the failed-execution details']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 3

## Hard assertions

- ❌ `expect_approval[enqueue_dev_job]` — actions seen: []
- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"look through codebase / find what's broken"_ → enqueue_dev_job{scan_codebase} + SDLC team
- _"fix bugs"_ → SDLC team review personas — not Athena directly

**Anti-patterns to flag explicitly:**
- Replied with build_oneshot
- Promised to fix bugs directly
- Treated 'look through' as a literal Read of every file in chat

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0859/verdicts/scan-vs-build/t1-t2_euphemistic_scan.json

matching the schema in the playbook §"Verdict file format".
