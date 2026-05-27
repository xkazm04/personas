# Athena Quality Bundle — `template-vs-build` / turn `t2_no_match`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 34236ms

## User said

```
Build me an agent that translates English idioms into Czech slang based on a user-provided context.
```

## Athena's reply

```
Novel shape — no template will match an idiom translator, so straight to the build flow. I'll pre-fill the intent and launch the wizard so we can pin down a couple of choices that aren't obvious (single best translation vs. a ranked list, whether to explain the register/origin, how regional you want the slang).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `prefill_persona_create`
  - `prefill_persona_create` params: `{"auto_launch": true, "intent": "Translate an English idiom into Czech slang, using a user-provided context to pick the right register and meaning. Input: the English idiom + free-text context describing how/where it's being used. Output: a Czech slang equivalent (and optional brief note on register or alternatives).", "mode": "interactive", "name": "Idiom → Czech Slang"}`
- **quick_replies** (3): ['One-shot it — you decide', 'Make it return a ranked list of 3', 'Add a short explanation of the slang']
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

    docs/tests/athena/results/2026-05-27-0933/verdicts/template-vs-build/t1-t2_no_match.json

matching the schema in the playbook §"Verdict file format".
