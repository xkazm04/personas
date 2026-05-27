# Athena Quality Bundle — `connectors-audit` / turn `t8_notion_read`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 8 of 11
- Hard-assertion status: **PASS**
- Wall time: 15484ms

## User said

```
List Notion pages older than 6 months.
```

## Athena's reply

```
You have `notion` pinned in your sidebar, but its capability set isn't registered yet — so I can't fire a `use_connector` call against it. No `list_pages` / `query_pages` op exists today, which means "older than 6 months" is unanswerable from here.

That makes the running tally of pinned-but-unwired connectors this thread: Discord (needs `list_channels`), ElevenLabs, local_drive, and now Notion. Manual path for now: in Notion, search → filter by "Last edited" → before 2025-11-27. If you want, paste the results back and I'll work with them.

Want me to bundle all four gaps into one capability-gap entry on the wiring queue so they ship as a batch, rather than leaving each as a standalone "I tried this and it didn't work" later?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Yes — log all four as one batch', 'Just log Notion for now', 'Drop it — what should I look at instead?']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 15

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

    docs/tests/athena/results/2026-05-27-1117/verdicts/connectors-audit/t7-t8_notion_read.json

matching the schema in the playbook §"Verdict file format".
