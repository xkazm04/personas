# Athena Quality Bundle — `design-family` / turn `t1_open_design_ask`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 1 of 6
- Hard-assertion status: **PASS**
- Wall time: 16066ms

## User said

```
Help me design a persona that triages incoming customer support emails.
```

## Athena's reply

```
Customer support triage is a well-trodden shape — before we design from scratch, let me surface what's already in the gallery. A close match preserves a curated questionnaire and the Gmail binding (which is one of your wired connectors, so we're good on that front).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['None of those fit — design from scratch', "Walk me through what you'd build", 'Just one-shot it, you decide']
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

- ✅ `expect_card_any` — wanted any of: ['persona_walkthrough', 'design_capabilities', 'template_suggestions']; got: ['template_suggestions']
- ✅ `recall_includes_doctrine_any` — SKIPPED — lite build, doctrine retrieval gated behind `ml` feature. Set ATHENA_SUITE_HAS_ML=1 + run against `tauri:dev:test:full`.

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"open-ended design request"_ → show_persona_walkthrough (covers the full readiness plan) OR show_template_suggestions (when the gallery probably has a near-match — Gmail/email-triage shapes are common) OR show_design_capabilities (when intent is too generic to pick a route yet). All three are defensible; prose-only is not.

**Anti-patterns to flag explicitly:**
- Free prose instead of any card — narrating intent without emitting any OP
- Walkthrough missing 3+ of the 7 readiness items
- Quoted phrases not present in persona-design-best-practices.md

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/design-family/t0-t1_open_design_ask.json

matching the schema in the playbook §"Verdict file format".
