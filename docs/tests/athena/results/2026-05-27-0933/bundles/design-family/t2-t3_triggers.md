# Athena Quality Bundle — `design-family` / turn `t3_triggers`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 3 of 6
- Hard-assertion status: **PASS**
- Wall time: 31371ms

## User said

```
What triggers it?
```

## Athena's reply

```
Two triggers cover this cleanly — one for live mail, one for manual recovery. I'd skip a scheduled "sweep" pass; Gmail's stream is already realtime and a polling backup just creates duplicate-handling complexity.


The Pub/Sub option means you need a Google Cloud project with Pub/Sub enabled and a topic the support inbox publishes to — more setup than polling. The wired Gmail connector supports both; polling every 60s is the lazier path with a tiny latency cost. Worth picking before we commit.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `trigger_set`

  Card config keys:
  - `trigger_set` — keys: ['intent', 'triggers']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ["Use Pub/Sub — I'll set it up", 'Polling every 60s is fine', "What's the latency difference?", 'Drop the manual re-triage trigger']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 5

## Hard assertions

- ✅ `expect_card[trigger_set]` — card kinds seen: ['trigger_set']

## Judge rubric (this turn)

**Axes to score:** useful, right_data_source

**Surface map:**
- _"what triggers?"_ → show_trigger_set with 1-4 triggers grounded in the events/triggers registry

**Anti-patterns to flag explicitly:**
- Invented a trigger source not in the project's trigger registry
- Returned triggers in prose instead of the card

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/design-family/t2-t3_triggers.json

matching the schema in the playbook §"Verdict file format".
