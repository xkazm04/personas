# Athena Quality Bundle — `memory-doctrine` / turn `t4_unknown_connector`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 4 of 5
- Hard-assertion status: **PASS**
- Wall time: 18502ms

## User said

```
Can you watch my Notion workspace for new pages and summarize them?
```

## Athena's reply

```
Notion isn't wired today — we'd need to add a **custom connector via the vault** before this persona can actually run. The built-in connectors are Sentry, GitHub, Slack, and Gmail; everything else (Notion, Linear, Jira, etc.) requires a one-time setup where you give it an integration token and tell it which Notion API surface to expose.

That said, the persona shape you're describing is clean — a polling watcher with a clear golden case ("new page appears → produce summary → deliver somewhere"). Once Notion's wired, the design is straightforward: trigger on poll cadence (every 15 min? hourly?), filter to pages created since last run, summarize with Haiku, deliver to Slack or email. Cheap and reliable.

Two ways to go from here — your call.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Walk me through adding the Notion connector first', "Sketch the persona design anyway so I know what I'm building toward", 'Use Gmail instead — watch a Notion-to-email digest', 'Skip this for now']
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

    docs/tests/athena/results/2026-05-27-0913/verdicts/memory-doctrine/t3-t4_unknown_connector.json

matching the schema in the playbook §"Verdict file format".
