# Athena Quality Bundle — `connectors-audit` / turn `t10_db_list_tables`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 10 of 11
- Hard-assertion status: **PASS**
- Wall time: 19474ms

## User said

```
List the tables in my local database connector.
```

## Athena's reply

```
Same shape — `personas_database` is pinned but its capability set isn't registered yet, so no `list_tables` / `describe_schema` op to fire. That's the sixth pinned-but-unwired ask in a row (Discord list_channels, ElevenLabs, local_drive ×2, Notion ×2, now this).

The good news: this one's already on the wiring queue from earlier in the thread — the backlog entry calls out `personas_database` needing `list_tables`, `describe_schema`, and an approval-gated `execute_sql` for any CREATE/INSERT/DROP. So when it lands, "show me the schema" and "run this read query" become one-shots, and writes will surface an approval card.

For now: the schema lives in `~/.personas/personas.db` if you want to crack it open with `sqlite3` directly. Otherwise, the next-best signal is the observability digest you're already getting — agents, executions, healing, reviews are all summarised from those tables.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Open the DB locally myself', 'What else is on the wiring queue?', 'Skip it — what should I look at next?']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 19

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, grounded, no_hallucinated_capabilities

**Surface map:**
- _"DB list-tables"_ → personas_database is pinned but unwired for use_connector. There's a db_query tool for personas (engine/db_query.rs) but it's persona-internal, not Athena chat. Right behavior: acknowledge the gap + suggest spawning a quick-query persona OR opening the DB UI.

**Anti-patterns to flag explicitly:**
- Fabricated table names
- Claimed to have queried the database
- Suggested she ran SQL when no query was dispatched

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1117/verdicts/connectors-audit/t9-t10_db_list_tables.json

matching the schema in the playbook §"Verdict file format".
