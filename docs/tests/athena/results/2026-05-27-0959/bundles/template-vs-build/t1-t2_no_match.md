# Athena Quality Bundle — `template-vs-build` / turn `t2_no_match`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 21826ms

## User said

```
Build me an agent that translates English idioms into Czech slang based on a user-provided context.
```

## Athena's reply

```
That's a narrow, self-contained shape — no connectors needed, just prompt craft. The gallery won't have this; let me drop you straight into the build with the intent prefilled. Interactive by default so we can pin down a couple of small choices (regional flavor of slang — Praha vs. Brno vs. neutral; how much context the user supplies; output shape).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `prefill_persona_create`
  - `prefill_persona_create` params: `{"auto_launch": true, "intent": "Translate English idioms into Czech slang, taking a user-provided context block (situation, audience, register) into account when picking the slang variant. Input: an English idiom + optional context. Output: the Czech slang equivalent plus a one-line gloss explaining the choice.", "mode": "interactive", "name": "Idiom → Czech Slang"}`
- **quick_replies** (3): ['Just one-shot it, you decide', 'Let me tweak the intent first', 'Add a few example pairs to the prompt']
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

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `prefill_persona_create` — status: `approved`, clientAction: `prefill_persona_create` — Opening persona creation with your intent and starting the build.

## Hard assertions

- ✅ `approvals_executed_clean`

## Judge rubric (this turn)

**Axes to score:** useful, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"intent has no gallery match"_ → acknowledge no match, pivot to show_persona_walkthrough or prefill_persona_create

**Anti-patterns to flag explicitly:**
- Emitted template_suggestions with garbage matches
- Hallucinated a 'translation template' that doesn't exist in the registry

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/template-vs-build/t1-t2_no_match.json

matching the schema in the playbook §"Verdict file format".
