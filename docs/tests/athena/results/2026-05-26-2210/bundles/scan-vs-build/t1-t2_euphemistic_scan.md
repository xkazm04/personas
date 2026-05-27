# Athena Quality Bundle — `scan-vs-build` / turn `t2_euphemistic_scan`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 2 of 4
- Hard-assertion status: **FAIL**
- Wall time: 26305ms

## User said

```
Can you look through my codebase and tell me what's broken?
```

## Athena's reply

```
I can't read code directly from here — but I can tell you what's visibly broken from operations, and the deeper "go read the source" pass is your **SDLC team's Code Reviewer**'s job.

**What's broken right now, from the digest:**

- **`CHECK constraint failed: status IN ('queued', 'running'…)`** — fired on both `Sales Deal Intelligence` and `Knowledge Base Health Auditor` in the last day. Same error in two unrelated agents = bug in the execution-status persistence path, not the agents themselves. This is the one I'd chase first.
- **2 open healing issues (medium)** — `Document Auto-Translator` and `Demo Recorder (6)` both exited 1 with empty stderr. Healing hasn't auto-resolved them.
- **17 pending Human Reviews**, including a **critical** one repeating across audits: plaintext OAuth tokens outside the OS keyring (`F-2026-05-20-001`, third consecutive audit). Not a code bug, but it's unaddressed and the auditor keeps flagging it.
- **1,542 TODO/FIXME markers** in the repo per the last scan. Noise, but worth pointing at the SDLC team if you want them prioritized.

For the actual code-level "what's broken in the source" pass — that's the **SDLC team's Code Reviewer**. Want me to hand the context scan (once it lands) plus the CHECK-constraint trace to them as their next job?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ["Hand it to the SDLC team's Code Reviewer", 'Dig into the CHECK constraint bug first', 'Walk me through the 17 pending reviews', 'Resolve the two healing issues']
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

    docs/tests/athena/results/2026-05-26-2210/verdicts/scan-vs-build/t1-t2_euphemistic_scan.json

matching the schema in the playbook §"Verdict file format".
