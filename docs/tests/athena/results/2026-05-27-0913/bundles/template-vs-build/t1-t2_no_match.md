# Athena Quality Bundle — `template-vs-build` / turn `t2_no_match`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 2 of 4
- Hard-assertion status: **PASS**
- Wall time: 30917ms

## User said

```
Build me an agent that translates English idioms into Czech slang based on a user-provided context.
```

## Athena's reply

```
Novel one — not the kind of thing the gallery has a near-match for, so I'd skip suggestions and go straight to a build. A few design choices are worth pinning before the prompt hardens: input shape (single idiom vs. batch), what "context" means (formal/informal register? Prague vs. Brno slang? generation?), and the trigger (chat-style on demand vs. API/webhook). The interactive wizard will walk you through those.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `prefill_persona_create`
  - `prefill_persona_create` params: `{"auto_launch": true, "intent": "Translate English idioms into Czech slang. The user provides the idiom plus context (target register, region, audience, situation), and the agent returns the most natural Czech slang equivalent — with a short note on why that variant fits the context, and optionally 1-2 alternatives.", "mode": "interactive", "name": "Idiom-to-Czech-Slang Translator"}`
- **quick_replies** (3): ['You decide — just one-shot it', 'Let me tune the intent first', 'Show me how to design this myself']
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

    docs/tests/athena/results/2026-05-27-0913/verdicts/template-vs-build/t1-t2_no_match.json

matching the schema in the playbook §"Verdict file format".
