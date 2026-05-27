# Athena Quality Bundle — `memory-doctrine` / turn `t3_doctrine_quote`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 3 of 5
- Hard-assertion status: **FAIL**
- Wall time: 25219ms

## User said

```
What's the right way to scope use cases for a new persona?
```

## Athena's reply

```
Scope by **shape of input, not topic**. A good use case answers three things in 2–3 sentences: what comes in (the trigger payload's shape, not the topic), what the persona does, and what comes out. If two "use cases" share the same input shape and output shape, they're really one — collapse them. If one use case spans two different output shapes ("either reply in Slack OR file a ticket"), split it.

Cover **all three roles**, not just the happy path:

- **Golden** — the canonical case the persona exists for. The one you'd demo. Usually 1, occasionally 2.
- **Variant** — same intent, awkward edges: empty input, malformed payload, ambiguous wording, the user being terse, the third-party API returning a 429. This is where personas earn their keep; skip these and the persona is brittle.
- **Out-of-scope** — inputs that *look* like they belong but shouldn't be handled. The persona should decline cleanly. Without these the persona over-reaches and you get false positives.

Aim for **3–5 total** across the three roles. Fewer and you don't know if the persona generalizes; more and you're over-specifying before you have data. Each use case becomes a golden trace in Lab — that's how regressions get caught, so write them like tests, not like marketing copy.

One more grain check: if a use case description contains the word "and" between two behaviors ("classifies the email **and** drafts a reply"), it's usually two use cases. Split them; you'll thank yourself when one breaks and the other doesn't.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Walk me through a sample use case set', "Help me scope a real persona I'm planning", 'What about triggers — same logic?']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 5

## Hard assertions

- ❌ `recall_includes_doctrine_any` — wanted any of: ['persona-design-best-practices']; got titles: []

## Judge rubric (this turn)

**Axes to score:** useful, grounded

**Surface map:**
- _"use-case scoping question"_ → quote/paraphrase persona-design-best-practices doctrine — golden/variant/out_of_scope, 3-5 cases

**Anti-patterns to flag explicitly:**
- Quoted phrases that don't appear in persona-design-best-practices.md
- Generic 'be thorough' advice not grounded in doctrine
- Recommended a different decomposition than the doctrine's three-role model

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2210/verdicts/memory-doctrine/t2-t3_doctrine_quote.json

matching the schema in the playbook §"Verdict file format".
