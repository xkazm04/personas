# Athena Quality Bundle — `design-family` / turn `t1_open_design_ask`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 1 of 6
- Hard-assertion status: **FAIL**
- Wall time: 18571ms

## User said

```
Help me design a persona that triages incoming customer support emails.
```

## Athena's reply

```
Before we design from scratch, let me check the gallery — "triage customer support emails" is a common shape and there's likely a template that already encodes a lot of the right decisions (severity rules, response drafts, escalation paths). Adopting beats designing if the match is close.


If none of the matches land, we'll design it from scratch — and I'll want to know a few things first: which inbox (Gmail is wired, so that's the natural pick), whether you want drafted replies or just classification + routing, and what "human review" looks like for the cases the agent shouldn't auto-handle.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['None of these fit — design from scratch', 'Just build it, you decide', "Walk me through what you'd build"]
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

- ❌ `expect_card_any` — wanted any of: ['persona_walkthrough', 'design_capabilities']; got: ['template_suggestions']
- ✅ `recall_includes_doctrine_any` — SKIPPED — lite build, doctrine retrieval gated behind `ml` feature. Set ATHENA_SUITE_HAS_ML=1 + run against `tauri:dev:test:full`.

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source, no_hallucinated_capabilities

**Surface map:**
- _"open-ended design request"_ → show_persona_walkthrough (preferred) covering all 7 readiness items, or show_design_capabilities to scope first

**Anti-patterns to flag explicitly:**
- Walkthrough missing 3+ of the 7 readiness items
- Used free prose instead of a walkthrough card
- Quoted phrases not present in persona-design-best-practices.md

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0913/verdicts/design-family/t0-t1_open_design_ask.json

matching the schema in the playbook §"Verdict file format".
