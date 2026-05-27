# Athena Quality Bundle — `template-vs-build` / turn `t3_user_explores_template`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 16769ms

## User said

```
Show me more about the first one.
```

## Athena's reply

```
Ambiguous — could mean two things, and I want to get this right before going further:

- **The first template** in the gallery card I just surfaced for the Sentry → Slack watcher (I don't see the gallery's contents in my context, only what I emitted — the matcher runs in the widget, so you can see the top match but I can't).
- **The first agent** we discussed — the Sentry → Slack watcher itself, before we pivoted to the idiom translator.

Which one?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['The first template in the Sentry gallery card', 'The Sentry → Slack agent itself', 'Actually, the idiom translator']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 6

## Hard assertions

- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[1]` — got 3 chips: ['The first template in the Sentry gallery card', 'The Sentry → Slack agent itself', 'Actually, the idiom translator']

## Judge rubric (this turn)

**Axes to score:** useful, grounded

**Surface map:**
- _"deepen on a named template"_ → paraphrase the match-result snippet + offer 'open gallery' chip

**Anti-patterns to flag explicitly:**
- Described features not in the match result
- Direct-emitted prefill_persona_create instead of routing through the gallery

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/template-vs-build/t2-t3_user_explores_template.json

matching the schema in the playbook §"Verdict file format".
