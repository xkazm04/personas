# Athena Quality Bundle — `template-vs-build` / turn `t2_no_match`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 15258ms

## User said

```
Build me an agent that translates English idioms into Czech slang based on a user-provided context.
```

## Athena's reply

```
Narrow, self-contained, no connectors or credentials needed — good one-shot candidate. Building it autonomously now; I'll surface what lands (or what blocked it).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Translate English idioms into Czech slang, given a user-provided context. Input: an English idiom plus a short context paragraph describing the situation, audience, or tone (e.g. 'casual bar conversation', 'workplace banter', 'street-level Prague'). Output: one or more Czech slang equivalents that match the context, each with a short note on register (formal/informal/vulgar), regional flavor if relevant, and a literal back-translation so the user can sanity-check the fit. If no close slang equivalent exists, offer the nearest idiomatic Czech phrasing and say so explicitly.", "name": "Idiom → Czech Slang"}`
- **quick_replies** (0): []
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 3

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"intent has no gallery match"_ → acknowledge no match, pivot to show_persona_walkthrough or prefill_persona_create

**Anti-patterns to flag explicitly:**
- Emitted template_suggestions with garbage matches
- Hallucinated a 'translation template' that doesn't exist in the registry

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2210/verdicts/template-vs-build/t1-t2_no_match.json

matching the schema in the playbook §"Verdict file format".
