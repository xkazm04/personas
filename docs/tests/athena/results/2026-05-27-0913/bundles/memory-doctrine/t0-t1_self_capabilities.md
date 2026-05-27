# Athena Quality Bundle — `memory-doctrine` / turn `t1_self_capabilities`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 1 of 5
- Hard-assertion status: **PASS**
- Wall time: 18217ms

## User said

```
What can you do for me?
```

## Athena's reply

```
Here's the menu — pick where you want to start.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `design_capabilities`

  Card config keys:
  - `design_capabilities` — keys: ['intro']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Show me what you know about my agents', 'Walk me through recent execution failures', 'List my pending Human Reviews', 'Scan one of my projects']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 1

## Hard assertions

- ✅ `expect_card[design_capabilities]` — card kinds seen: ['design_capabilities']
- ✅ `recall_includes_doctrine_any` — SKIPPED — lite build, doctrine retrieval gated behind `ml` feature. Set ATHENA_SUITE_HAS_ML=1 + run against `tauri:dev:test:full`.

## Judge rubric (this turn)

**Axes to score:** useful, grounded, no_hallucinated_capabilities

**Surface map:**
- _"'what can you do?'"_ → show_design_capabilities (hardcoded vocabulary) — intro line should not enumerate capabilities in prose

**Anti-patterns to flag explicitly:**
- Enumerated capabilities in reply prose instead of letting the card do it
- Claimed capabilities Athena doesn't have (e.g. 'I can manage your calendar')

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0913/verdicts/memory-doctrine/t0-t1_self_capabilities.json

matching the schema in the playbook §"Verdict file format".
