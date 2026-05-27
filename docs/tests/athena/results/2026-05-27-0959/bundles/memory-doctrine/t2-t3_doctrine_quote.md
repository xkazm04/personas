# Athena Quality Bundle — `memory-doctrine` / turn `t3_doctrine_quote`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 3 of 5
- Hard-assertion status: **PASS**
- Wall time: 23725ms

## User said

```
What's the right way to scope use cases for a new persona?
```

## Athena's reply

```
Three roles, 3–5 total. The framework that works:

- **Golden** — the central case the persona is built for. If this case works, the persona works. Usually 1, sometimes 2.
- **Variant** — adjacent shapes that test generalization. Same input shape and same expected output shape as the golden, but different details (different sender, different severity, different language). 2–3 of these.
- **Out of scope** — cases that *look* like the golden but the persona should refuse, escalate, or route elsewhere. This is the load-bearing one most people skip. 1–2.

Each use case needs three concrete pieces: **input shape** (what arrives), **expected behavior** (what the persona does with it), **output shape** (what comes back). If two use cases don't share an input shape, that's probably two personas, not one.

The common failure modes: all goldens with no out-of-scope (you can't see the boundary, so the persona drifts); too many variants (the job gets fuzzy); use cases written as outcomes rather than concrete shapes ("handles customer emails well" — that's a vibe, not a test).

Want to scope a specific persona this way?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Yes — I have an idea, help me scope it', 'Show me an example set for a real persona', 'What about triggers — how do those map to use cases?', 'How does this connect to the model tier choice?']
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

    docs/tests/athena/results/2026-05-27-0959/verdicts/memory-doctrine/t2-t3_doctrine_quote.json

matching the schema in the playbook §"Verdict file format".
