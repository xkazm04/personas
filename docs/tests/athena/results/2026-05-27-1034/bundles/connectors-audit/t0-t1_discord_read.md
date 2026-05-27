# Athena Quality Bundle — `connectors-audit` / turn `t1_discord_read`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 1 of 11
- Hard-assertion status: **PASS**
- Wall time: 11172ms

## User said

```
Check the last activity in my Discord — what's been happening on the main channel?
```

## Athena's reply

```
Discord is pinned but its capability set isn't wired yet — I can see it attached in your sidebar, but I don't have a `use_connector` call available for it. So I can't pull the channel activity directly.

If you want this working, the next step is wiring the Discord connector capabilities (list channels, fetch recent messages). Want me to log that as a capability gap so it doesn't slip?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Log it as a capability gap', 'Show me what connectors are wired', 'Never mind']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
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

    docs/tests/athena/results/2026-05-27-1034/verdicts/connectors-audit/t0-t1_discord_read.json

matching the schema in the playbook §"Verdict file format".
