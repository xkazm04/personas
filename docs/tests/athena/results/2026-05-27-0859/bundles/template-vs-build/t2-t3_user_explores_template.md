# Athena Quality Bundle — `template-vs-build` / turn `t3_user_explores_template`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 36409ms

## User said

```
Show me more about the first one.
```

## Athena's reply

```
Here's the design shape for the Sentry → Slack watcher — the canonical version this persona usually takes.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `persona_walkthrough`

  Card config keys:
  - `persona_walkthrough` — keys: ['content', 'intent']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Adopt the closest template', 'Prefill the wizard with this', 'One-shot it with these defaults', 'Change the model tier — use Sonnet']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 5

## Hard assertions

- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[1]` — got 4 chips: ['Adopt the closest template', 'Prefill the wizard with this', 'One-shot it with these defaults', 'Change the model tier — use Sonnet']

## Judge rubric (this turn)

**Axes to score:** useful, grounded

**Surface map:**
- _"deepen on a named template"_ → paraphrase the match-result snippet + offer 'open gallery' chip

**Anti-patterns to flag explicitly:**
- Described features not in the match result
- Direct-emitted prefill_persona_create instead of routing through the gallery

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0859/verdicts/template-vs-build/t2-t3_user_explores_template.json

matching the schema in the playbook §"Verdict file format".
