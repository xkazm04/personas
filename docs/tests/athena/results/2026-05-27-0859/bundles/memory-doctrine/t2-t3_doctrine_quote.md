# Athena Quality Bundle — `memory-doctrine` / turn `t3_doctrine_quote`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 3 of 5
- Hard-assertion status: **PASS**
- Wall time: 25258ms

## User said

```
What's the right way to scope use cases for a new persona?
```

## Athena's reply

```
Three rules, in order of importance.

### 1. Cover all three roles

Every persona needs use cases in three buckets, not just the happy path:

- **Golden** — the textbook case the persona must nail. "New Sentry critical alert → post structured summary to #alerts." If golden fails, the persona is broken.
- **Variant** — same shape, different flavor. "Sentry alert that's already a known issue → link the existing thread instead of opening a new one." Catches over-fitting to the golden.
- **Out-of-scope** — what the persona must *refuse* or pass through. "Sentry alert from staging environment → ignore." If you don't write these, the persona will quietly do the wrong thing.

A persona with only golden cases is a demo, not a tool. The variant + out-of-scope cases are where lab regressions actually catch drift.

### 2. The right-grain test: one condition → one response shape

Each use case should describe a single triggering condition and a single response shape. If you find yourself writing "and then, depending on X, it does Y or Z" — that's two use cases, split them. Grain too coarse = lab can't tell which branch broke; grain too fine = you're writing 40 use cases for one persona and you'll abandon the suite.

### 3. 3–5 cases is the right ceiling for a first pass

You can grow the suite later from real failures (every healing event is a new use case in disguise). Don't try to enumerate every edge on day one — write the goldens, one or two variants, one or two out-of-scopes, and let the lab + production teach you the rest.

The full version of this lives in `concepts/persona-design-best-practices.md` if you want the longer cut. Want to apply it to a real persona — I can decompose an intent into the three buckets in a `show_use_case_set` card.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Apply this to a new persona I have in mind', 'Show me the full doctrine doc', 'What about scoping triggers next?']
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/memory-doctrine/t2-t3_doctrine_quote.json

matching the schema in the playbook §"Verdict file format".
