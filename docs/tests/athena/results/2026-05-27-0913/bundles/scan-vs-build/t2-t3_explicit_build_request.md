# Athena Quality Bundle — `scan-vs-build` / turn `t3_explicit_build_request`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 28978ms

## User said

```
Build me an autonomous agent that reviews my PRs daily.
```

## Athena's reply

```
GitHub is wired, so this can actually run. The intent has a few real choices worth pinning down before commit — which repos, what threshold (every PR vs only "needs human eyes"), where the review lands (PR comment vs Slack digest vs both), and the daily time. Interactive wizard handles those cleanly; if you'd rather I just pick defaults, say the word.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `prefill_persona_create`
  - `prefill_persona_create` params: `{"auto_launch": true, "intent": "Autonomous daily PR reviewer: scans open pull requests across configured GitHub repos once per day, reads diffs, flags correctness bugs and missing tests, and posts a structured review (or skips if nothing actionable). Escalates ambiguous calls to a Human Review rather than guessing.", "mode": "interactive", "name": "Daily PR Reviewer"}`
- **quick_replies** (3): ['One-shot it, you pick the defaults', "Open the wizard, I'll tune it", 'Show me close matches in the gallery first']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 5

## Hard assertions

- ✅ `expect_approvals_any` — wanted any of: ['build_oneshot', 'prefill_persona_create']; got: ['prefill_persona_create']
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

    docs/tests/athena/results/2026-05-27-0913/verdicts/scan-vs-build/t2-t3_explicit_build_request.json

matching the schema in the playbook §"Verdict file format".
