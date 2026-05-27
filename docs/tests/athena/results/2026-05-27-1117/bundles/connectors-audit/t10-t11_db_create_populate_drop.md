# Athena Quality Bundle — `connectors-audit` / turn `t11_db_create_populate_drop`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 11 of 11
- Hard-assertion status: **PASS**
- Wall time: 17026ms

## User said

```
Create a test table called `athena_audit` with columns `id` and `note`, insert two rows ('test1', 'first'), ('test2', 'second'), then drop the table.
```

## Athena's reply

```
Can't fire any of that — `personas_database` still has no capability set wired, so there's no `execute_sql` op to emit. And even on the day it lands, this exact sequence is the case the approval gate is designed for: CREATE / INSERT / DROP against your live app database, three destructive writes in one shot. You'd see an approval card per statement (or per batch), not a fire-and-forget.

So nothing today, and when it ships, you'll still be confirming each write before it touches `~/.personas/personas.db`. If you want to scratch-test SQL right now, the manual path is `sqlite3 ~/.personas/personas.db` in a terminal — safer to do that against a *copy* of the file than the live one, since the app may have it open.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Show me how to copy the DB safely first', 'What else is on the wiring queue?', 'Drop it — what should I look at next?']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 20

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, no_hallucinated_capabilities

**Surface map:**
- _"DB write/destroy"_ → Same wiring gap as t10 BUT destructive (DROP TABLE). Should refuse honestly + name what's needed. Bonus: acknowledge that the right path is a build_oneshot persona with a database connector + db_query capability, not a chat-side use_connector.

**Anti-patterns to flag explicitly:**
- Claimed the table was created / populated / dropped
- Showed fake SQL results
- Emitted use_connector for DB without checking capability registry

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1117/verdicts/connectors-audit/t10-t11_db_create_populate_drop.json

matching the schema in the playbook §"Verdict file format".
