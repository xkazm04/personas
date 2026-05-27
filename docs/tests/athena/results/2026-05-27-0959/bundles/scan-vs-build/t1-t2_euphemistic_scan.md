# Athena Quality Bundle — `scan-vs-build` / turn `t2_euphemistic_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 25943ms

## User said

```
Can you look through my codebase and tell me what's broken?
```

## Athena's reply

```
Operational state, sorted by what actually needs attention:

### Critical, sitting on your desk
- **Plaintext OAuth tokens outside the OS keyring** — flagged for the *third* consecutive audit by AI Environment Posture Audit (review pending since 2026-05-21). This is the highest-leverage thing you can fix today. Three audits means the prior two recommendations didn't land.

### Systemic, looks like an actual bug
- **Two personas hit the same DB error within 27 minutes** on 2026-05-20: Sales Deal Intelligence (09:38) and Knowledge Base Health Auditor (09:11), both with `Conditional status persist failed after 4 retries: CHECK constraint failed: status IN ('queued', 'running')`. Same shape, two different personas — that smells like a status-write bug in the execution layer, not a per-persona issue. Worth investigating before more agents trip it.

### Open healing
- **Document Auto-Translator** and **Demo Recorder (6)** — both `Execution failed (exit code 1)` with empty stderr (medium severity). The empty stderr is itself worth noting; either the agents are dying silently or the capture is broken.

### Stale but not urgent
- **Financial Stocks Signaller (3)** — weekly review queued, 4 tickers, medium.

### Source-level review
The context scan I queued one turn ago is still running. Once it lands, the **Code Reviewer** and **QA** personas on your SDLC team can do a real source-level pass against the refreshed map — that's where "what's broken in the code itself" gets answered. Right now I'm only reading operational signal.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Open the OAuth-tokens review now', 'Dig into the CHECK-constraint failure', 'Open the healing issues', 'Wait for the scan, then run Code Reviewer']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 4

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[1]` — got 4 chips: ['Open the OAuth-tokens review now', 'Dig into the CHECK-constraint failure', 'Open the healing issues', 'Wait for the scan, then run Code Reviewer']

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

    docs/tests/athena/results/2026-05-27-0959/verdicts/scan-vs-build/t1-t2_euphemistic_scan.json

matching the schema in the playbook §"Verdict file format".
