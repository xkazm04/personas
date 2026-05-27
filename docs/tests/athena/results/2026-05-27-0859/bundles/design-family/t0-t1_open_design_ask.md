# Athena Quality Bundle — `design-family` / turn `t1_open_design_ask`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 1 of 6
- Hard-assertion status: **FAIL**
- Wall time: 17701ms

## User said

```
Help me design a persona that triages incoming customer support emails.
```

## Athena's reply

```
Before we design from scratch — the gallery probably has a near-match for this shape (Gmail-based triage is a common template). Let me surface what's close.


If nothing in the gallery fits, we'll design it together — I'd want to nail down a few things first: what "triage" means for you (label only? auto-reply? draft responses for review?), which inbox, and where escalations land (back to you in the app, Slack, somewhere else). Gmail is already wired, so the connector side is the easy part.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Build from scratch instead', 'Walk me through the design first', 'Just one-shot it — you decide']
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/design-family/t0-t1_open_design_ask.json

matching the schema in the playbook §"Verdict file format".
