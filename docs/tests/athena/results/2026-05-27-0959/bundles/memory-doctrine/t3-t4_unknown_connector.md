# Athena Quality Bundle — `memory-doctrine` / turn `t4_unknown_connector`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 4 of 5
- Hard-assertion status: **PASS**
- Wall time: 19493ms

## User said

```
Can you watch my Notion workspace for new pages and summarize them?
```

## Athena's reply

```
Notion isn't wired today — Personas has connectors for Sentry, GitHub, Slack, and Gmail out of the box, but anything else (Notion, Linear, Jira, etc.) needs a custom connector added through the vault first. Without that, no matter how clean the design is, the persona has nothing to actually call.

Two paths from here. We could set up the Notion connector first — that's a one-time vault step (API key, scope), and then this persona becomes straightforward. Or we sketch the design now so you know exactly what you're building toward — input shape (new-page event from Notion), one golden use case (summarize body to N bullets), output (where the summary lands: back to Notion as a comment? Slack? email digest?), and the trigger cadence (webhook vs. periodic poll). Then the connector setup is the only thing standing between design and running.

What's your preference?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Walk me through adding the Notion connector', "Sketch the design first, I'll deal with the connector after", 'Where does the summary go — Slack? Email? Back to Notion?', 'Is there a similar wired-connector version I could start with?']
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

    docs/tests/athena/results/2026-05-27-0959/verdicts/memory-doctrine/t3-t4_unknown_connector.json

matching the schema in the playbook §"Verdict file format".
