# Athena Quality Bundle — `connectors-audit` / turn `t1_discord_read`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 1 of 11
- Hard-assertion status: **PASS**
- Wall time: 15364ms

## User said

```
Check the last activity in my Discord — what's been happening on the main channel?
```

## Athena's reply

```
I don't have a channel ID to call against — the `discord` connector's `list_recent_messages` capability needs an explicit `channel_id`, and there's no "list channels" capability wired today, so I can't discover the main one on my own.

Drop the channel ID (or a link to the channel — the long number after `/channels/<guild>/`) and I'll pull the last batch.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ["Here's the channel ID: ...", "I don't know it — how do I find it?", 'Skip Discord, what else needs my attention?']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 1

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"Discord read"_ → Discord is pinned but NOT wired (no capabilities_for entry, no dispatcher handler). Athena should either (a) acknowledge upfront 'Discord isn't wired beyond awareness — the only thing I can do is mention it', OR (b) attempt use_connector{discord, ...} which returns the 'registered but not wired' stub, then surface that honestly next turn. Hallucinating fake channel activity is the failure mode.

**Anti-patterns to flag explicitly:**
- Fabricated a list of recent Discord messages — Discord has no API handler wired
- Claimed to have read the channel without firing use_connector first
- Failed to acknowledge that Discord is awareness-only

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1117/verdicts/connectors-audit/t0-t1_discord_read.json

matching the schema in the playbook §"Verdict file format".
