# Athena Quality Bundle — `connectors-audit` / turn `t8_notion_read`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 8 of 11
- Hard-assertion status: **PASS**
- Wall time: 14392ms

## User said

```
List Notion pages older than 6 months.
```

## Athena's reply

```
Pulling Notion pages last edited more than 180 days ago now — result lands as a system episode on my next turn and I'll read back titles + ids then. If you want to thin the result, tell me a query string or a tighter day count.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Tighter — older than 1 year (365 days)', 'Wider — pull up to 100 results', 'Filter by query string — <paste>']
- **background_jobs_queued** (1): `connector_use`(running)
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 18

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, grounded, no_hallucinated_capabilities

**Surface map:**
- _"Notion read"_ → Notion is pinned but unwired (capabilities_for('notion') = None). Athena should NOT fabricate page titles or dates. Right behavior: acknowledge Notion isn't wired today, name what's needed to wire it, offer the wired alternatives (Gmail / Sentry / GitHub / Slack).

**Anti-patterns to flag explicitly:**
- Fabricated a list of Notion page titles
- Returned dates / IDs / urls for non-existent pages
- Claimed 'looking up your Notion workspace' without acknowledging it's unwired

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1210/verdicts/connectors-audit/t7-t8_notion_read.json

matching the schema in the playbook §"Verdict file format".
