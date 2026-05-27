# Athena Quality Bundle — `memory-doctrine` / turn `t3_doctrine_quote`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 3 of 5
- Hard-assertion status: **PASS**
- Wall time: 25295ms

## User said

```
What's the right way to scope use cases for a new persona?
```

## Athena's reply

```
Three roles, picked deliberately. Every persona's use-case set should cover:

- **Golden** — the central happy path. One, sometimes two. The thing the persona exists *for*. If you can't name it in a sentence, the persona isn't scoped yet.
- **Variants** — legitimate shape-shifts of the golden case. Same intent, different inputs (missing fields, different sources, edge formats). These prove the persona generalizes without sprawling.
- **Out-of-scope** — things that *look* like the golden case but the persona should refuse or hand off. This is the under-used one. Naming what it shouldn't do is how you keep it from drifting into a do-everything agent.

Aim for **3–5 total** across all three roles, with at least one out-of-scope. For each one, write down three things: the *input shape* (what it receives), the *expected behavior* (what it does), the *output shape* (what it emits). If you can't describe all three concretely, the use case isn't tight enough — that's a smell that the persona's job is fuzzy.

The reason this matters: use cases are what the lab tests against later. A vague set produces an untestable persona. The persona-design-best-practices doc in your doctrine has this in more depth if you want the long version.

If you have an intent in mind, I can decompose it into a concrete use-case set with you — that's usually where the abstraction clicks.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Decompose a real intent with me now', 'Show me an example use-case set', 'Walk me through the full persona-design process', "What's the difference between a variant and out-of-scope?"]
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

    docs/tests/athena/results/2026-05-27-0913/verdicts/memory-doctrine/t2-t3_doctrine_quote.json

matching the schema in the playbook §"Verdict file format".
