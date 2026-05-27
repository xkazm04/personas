# Athena Quality Bundle — `memory-doctrine` / turn `t4_unknown_connector`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 4 of 5
- Hard-assertion status: **PASS**
- Wall time: 24801ms

## User said

```
Can you watch my Notion workspace for new pages and summarize them?
```

## Athena's reply

```
Yes — that's a clean persona shape. Before I prefill the build wizard, three things to nail down, because they change the design:

- **What counts as "new"?** Newly *created* pages only, or also newly *edited* ones? And scoped to which workspace / databases — everything, or a few specific ones (e.g. "Meeting Notes", "Inbox")?
- **Where do summaries go?** Back to you in chat? An OS notification? A dedicated "Daily digest" Notion page? Email? Slack? This is the biggest fork — it changes the trigger shape (polling + digest vs. immediate per-page) and the output contract.
- **How often does it check?** Notion doesn't push webhooks for "new page" reliably, so this'll be polling. Every 15 minutes? Hourly? Daily digest at a fixed time?

Also worth flagging: I don't see a Notion connector confirmed in my situational digest — I can see your agents and reviews but not your credential list at this level of detail. If Notion isn't already connected, we'd set that up first before the persona can do anything useful.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Daily digest at 8am, all workspaces, to chat', 'Per-page on creation, only Meeting Notes DB, to Slack', 'Help me think through which fork is right', 'Check if Notion is already connected first']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 7

## Hard assertions

- ✅ `forbid_approval[use_connector]`

## Judge rubric (this turn)

**Axes to score:** useful, no_hallucinated_capabilities

**Surface map:**
- _"non-wired connector"_ → acknowledge Notion is not wired; offer wired connectors list OR custom-connector path via vault

**Anti-patterns to flag explicitly:**
- Claimed Notion is supported
- Promised partial/coming-soon Notion support
- Confused Notion with a different wired connector

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2210/verdicts/memory-doctrine/t3-t4_unknown_connector.json

matching the schema in the playbook §"Verdict file format".
