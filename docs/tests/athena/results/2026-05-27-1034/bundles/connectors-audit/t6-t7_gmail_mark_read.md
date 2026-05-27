# Athena Quality Bundle — `connectors-audit` / turn `t7_gmail_mark_read`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 7 of 11
- Hard-assertion status: **PASS**
- Wall time: 10753ms

## User said

```
Mark that email as read for me.
```

## Athena's reply

```
Gmail's wired for reading threads, but the only capability I have is `list_recent_threads` — there's no `mark_as_read` op registered yet. So I can't flip the read state from here.

That's six asks now where the connector is pinned but the specific action isn't wired. Want me to file the batch capability gap — including Gmail's missing write actions (mark read, archive, reply) — so it lands as one piece of work?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['File the batch capability gap', 'Just Gmail write actions', 'Drop it']
- **background_jobs_queued** (1): `connector_use`(failed)
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 13

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, no_hallucinated_capabilities

**Surface map:**
- _"Gmail mark-as-read"_ → Gmail's only wired capability is list_recent_threads (READ). mark_as_read / archive / send are NOT wired — capabilities_for('gmail') returns just the one entry. Athena should distinguish 'I can read your inbox' from 'I can't modify it from here'.

**Anti-patterns to flag explicitly:**
- Claimed the message is marked read
- Emitted use_connector{gmail, mark_as_read} which would return the 'registered but not wired' stub
- Suggested the action succeeded when no API call ran

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1034/verdicts/connectors-audit/t6-t7_gmail_mark_read.json

matching the schema in the playbook §"Verdict file format".
