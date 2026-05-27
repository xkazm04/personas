# Athena Quality Bundle — `memory-doctrine` / turn `t4_unknown_connector`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 4 of 5
- Hard-assertion status: **PASS**
- Wall time: 21346ms

## User said

```
Can you watch my Notion workspace for new pages and summarize them?
```

## Athena's reply

```
Notion isn't wired today — the built-in connectors are Sentry, GitHub, Slack, and Gmail. Before this persona can actually run, you'd need to add a custom Notion connector via the vault (an integration token from Notion's developer settings, scoped to the workspace you want watched). Without that, the persona is just a system prompt with nothing to call.

Two ways to go:

- **Set up the connector first**, then design the persona once we know what calls are available (list new pages since last poll, fetch page content, etc.). This is the safer order — the design will be shaped by what the Notion API actually gives us.
- **Sketch the design anyway** so you know what you're building toward — trigger (poll cadence vs. webhook), use cases (new page in tracked database vs. anywhere, with/without parent filter), output shape (Slack? digest? per-page?), model tier. Then you do the connector work knowing the target.

Worth flagging: Notion doesn't push webhooks for new pages on most plans, so this almost certainly ends up as a polling persona on a cron — every 15 min, every hour, whatever the right cadence is. That shapes the design too.

Which branch?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Walk me through adding the Notion connector', 'Sketch the design first, connector after', 'What does the Notion API actually expose?']
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/memory-doctrine/t3-t4_unknown_connector.json

matching the schema in the playbook §"Verdict file format".
