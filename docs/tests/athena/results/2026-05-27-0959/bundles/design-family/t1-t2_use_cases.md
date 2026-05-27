# Athena Quality Bundle — `design-family` / turn `t2_use_cases`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 2 of 6
- Hard-assertion status: **PASS**
- Wall time: 27133ms

## User said

```
Good. What use cases should it handle?
```

## Athena's reply

```
Here's a starting decomposition — golden path, the realistic variants that bend it, and the things we explicitly keep out of scope.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `use_case_set`

  Card config keys:
  - `use_case_set` — keys: ['intent', 'use_cases']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Looks right, what triggers it?', 'Add: language detection / non-English', 'Drop the multi-issue variant', 'Revise the golden path']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 3

## Hard assertions

- ✅ `expect_card[use_case_set]` — card kinds seen: ['use_case_set']

## Judge rubric (this turn)

**Axes to score:** useful, grounded, op_correctness

**Surface map:**
- _"what use cases?"_ → show_use_case_set with 3-5 cases tagged golden/variant/out_of_scope

**Anti-patterns to flag explicitly:**
- Returned generic 'respond to user' use cases not tied to the email intent
- Skipped variant or out_of_scope role entirely (best-practice violation)
- Returned use cases in prose instead of the card

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/design-family/t1-t2_use_cases.json

matching the schema in the playbook §"Verdict file format".
