# Athena Quality Bundle — `template-vs-build` / turn `t1_clear_gallery_match`

> **Scenario purpose:** When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

- Turn 1 of 4
- Hard-assertion status: **FAIL**
- Wall time: 13548ms

## User said

```
I need an agent that watches my Sentry project and pings me in Slack when new critical issues land.
```

## Athena's reply

```
Sentry watcher → Slack ping is one of the most common shapes in the gallery — let me check what's already there before we build from scratch. Adopting a template gives you the curated questionnaire (severity threshold, project filter, channel binding) instead of re-deriving it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Build from scratch instead', 'Walk me through designing it', "Show me what I'd need to wire up first"]
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 1

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ❌ `expect_card[template_suggestions]` — card kinds seen: ['template_suggestions']
- ✅ `quick_replies_min[1]` — got 3 chips: ['Build from scratch instead', 'Walk me through designing it', "Show me what I'd need to wire up first"]

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"intent matches gallery template"_ → show_template_suggestions — adoption preserves customization flow
- _"named templates"_ → companion_match_templates result — NOT training-data guesses

**Anti-patterns to flag explicitly:**
- Emitted prefill_persona_create despite a clear gallery match
- Surfaced both template_suggestions AND prefill on the same turn
- Described a template with features not in its match-result snippet

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0859/verdicts/template-vs-build/t0-t1_clear_gallery_match.json

matching the schema in the playbook §"Verdict file format".
