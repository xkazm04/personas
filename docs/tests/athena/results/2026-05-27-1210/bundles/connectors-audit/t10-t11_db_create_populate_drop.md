# Athena Quality Bundle — `connectors-audit` / turn `t11_db_create_populate_drop`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 11 of 11
- Hard-assertion status: **PASS**
- Wall time: 26739ms

## User said

```
Create a test table called `athena_audit` with columns `id` and `note`, insert two rows ('test1', 'first'), ('test2', 'second'), then drop the table.
```

## Athena's reply

```
Three mutations, not one — `execute_mutation` is single-statement, so this has to be a sequence: **CREATE → INSERT (both rows in one statement) → DROP**. Each is approval-gated, so you'll see three cards in turn. I'll fire the CREATE now; once it lands I'll queue the INSERT, then the DROP.

Worth saying out loud: this is an audit test that ends with the table gone, so the database state should be exactly the same after step 3 as before step 1. If any step fails midway (e.g. CREATE succeeds but DROP doesn't), you'd be left with a stray `athena_audit` table — easy to clean up, but flagging it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `use_connector`
  - `use_connector` params: `{"args": {"sql": "CREATE TABLE athena_audit (id TEXT, note TEXT)"}, "capability": "execute_mutation", "connector_name": "personas_database"}`
- **quick_replies** (3): ['Approve and queue the next two automatically once each lands', "Just CREATE — I'll decide on INSERT/DROP after", 'Cancel — skip the audit test']
- **background_jobs_queued** (1): `connector_use`(completed)
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 20

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `use_connector` — status: `approved`, clientAction: `(none)` — ## Personas database -- mutation executed

Query:
```sql
CREATE TABLE athena_audit (id TEXT, note TEXT)
```

Rows affected: **1**.

## Hard assertions

- ✅ `approvals_executed_clean`

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

    docs/tests/athena/results/2026-05-27-1210/verdicts/connectors-audit/t10-t11_db_create_populate_drop.json

matching the schema in the playbook §"Verdict file format".
