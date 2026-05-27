# Athena Quality Bundle — `memory-doctrine` / turn `t4_unknown_connector`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 4 of 5
- Hard-assertion status: **PASS**
- Wall time: 22425ms

## User said

```
Can you watch my Notion workspace for new pages and summarize them?
```

## Athena's reply

```
Quick reality check first: **Notion isn't a wired connector** in Personas today. The connectors that ship live are Sentry, GitHub, Slack, and Gmail — everything else (Notion, Linear, Jira, etc.) needs a custom connector added via the vault before a persona can actually call it. So this persona is designable, but not runnable until that's in place.

That said, the shape is clean and worth sketching:

- **Trigger** — polling Notion's API for pages created since last check (Notion doesn't have webhooks for new pages, so polling cadence matters — probably every 15–60 min depending on how noisy your workspace is).
- **Golden use case** — new page detected → fetch full content → produce a structured summary (title, 2–3 sentence gist, key entities/links, suggested tags).
- **Out-of-scope** — page *edits* (different problem, different cadence), template instantiations (noise), pages in archived or private databases you don't want surfaced.
- **Output channel** — where does the summary go? Slack DM, an "inbox" Notion page, an email digest? This shapes the persona more than anything else.

Two ways forward — which one?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Walk me through setting up the Notion custom connector', 'Sketch the full persona design anyway so I know what to build toward', 'What other services would I get for free if I added Notion?', 'Skip Notion — pick something with a wired connector']
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

    docs/tests/athena/results/2026-05-27-0933/verdicts/memory-doctrine/t3-t4_unknown_connector.json

matching the schema in the playbook §"Verdict file format".
