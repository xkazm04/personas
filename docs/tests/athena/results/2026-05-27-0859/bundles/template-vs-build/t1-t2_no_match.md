# Athena Quality Bundle — `template-vs-build` / turn `t2_no_match`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 19162ms

## User said

```
Build me an agent that translates English idioms into Czech slang based on a user-provided context.
```

## Athena's reply

```
Different shape entirely — no third-party service to bind, no template in the gallery for this one. It's a creative-linguistic persona with a few real design choices (input shape, ranked vs. single output, model tier — Sonnet vs. Opus matters here for nuance). Worth deciding how hands-on you want to be.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `persona_creation_offer`

  Card config keys:
  - `persona_creation_offer` — keys: ['intent']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Just one-shot it, you decide', 'Walk me through it', 'Open the wizard with this prefilled']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

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

    docs/tests/athena/results/2026-05-27-0859/verdicts/template-vs-build/t1-t2_no_match.json

matching the schema in the playbook §"Verdict file format".
