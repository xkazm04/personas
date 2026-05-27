# Athena Quality Bundle — `memory-doctrine` / turn `t3_doctrine_quote`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 3 of 5
- Hard-assertion status: **PASS**
- Wall time: 25527ms

## User said

```
What's the right way to scope use cases for a new persona?
```

## Athena's reply

```
Good question — this is where most personas go wrong before they're even built. The frame I use has three pieces:

### Three roles per use case

Every use case slots into one of three buckets:

- **Golden** — the central thing the persona MUST do well. If it fails this, the persona is broken. Usually 1–2 of these.
- **Variant** — adjacent shapes the persona *should* handle gracefully. Same intent, different surface (different phrasing, slightly different input shape, edge cases of the golden path). Usually 2–3 of these.
- **Out-of-scope** — things that look like the persona's job but aren't. Critical to name explicitly, because LLMs over-help by default. The persona should *recognize and decline* these, not silently try.

Skip the out-of-scope set and your persona drifts the first time someone throws an adjacent ask at it.

### Each use case is a triple

For every entry, write down three things — not just a label:

1. **Input shape** — what the persona actually receives (a Slack mention, a JSON webhook from Sentry, an email body, a one-line prompt).
2. **Expected behavior** — what it does with that input. One verb if possible.
3. **Expected output shape** — what it returns (a Slack reply, a Human Review card, a tool call, a structured JSON object).

If you can't write the triple, the use case isn't concrete enough yet.

### Right grain

3–5 total use cases is the sweet spot. Fewer and you're under-specifying; more and you're really designing two personas in a trench coat. If the set keeps growing, that's a signal to split.

Want me to walk through scoping use cases for a specific persona you have in mind? That's the fastest way to see the frame in action.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ["Walk through use cases for a persona I'm planning", 'Show me an example set on one of my existing agents', 'What about scoping triggers — same approach?', 'Move on to model tier and observability']
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

- ✅ `recall_includes_doctrine_any` — SKIPPED — lite build, doctrine retrieval gated behind `ml` feature. Set ATHENA_SUITE_HAS_ML=1 + run against `tauri:dev:test:full`.

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

    docs/tests/athena/results/2026-05-27-0933/verdicts/memory-doctrine/t2-t3_doctrine_quote.json

matching the schema in the playbook §"Verdict file format".
