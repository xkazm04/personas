# Athena Quality Bundle — `design-family` / turn `t1_open_design_ask`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 1 of 6
- Hard-assertion status: **FAIL**
- Wall time: 36933ms

## User said

```
Help me design a persona that triages incoming customer support emails.
```

## Athena's reply

```
Triage is a good first persona because the scope is tight — read an email, decide what bucket it belongs in, route from there. The trap is letting it grow into a full reply-drafter; keep those as separate personas downstream.

Before we design from scratch, let me check what's already templated for this shape:


While you're skimming those, the two decisions that shape everything else:

- **Where do the emails live?** Gmail, Outlook, a help desk like Zendesk/Intercom? The trigger and the connector both fall out of this.
- **What does "triaged" look like as output?** A label in the inbox? A Slack ping to a channel? A row in a tracker? A drafted reply you approve? Each one is a different shape — and a different persona.

Tell me those two and I can either point you at the right template or scaffold a fresh design with `show_persona_walkthrough`.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Gmail, just label and tag for now', 'Gmail, draft replies for me to approve', 'Different inbox — let me explain', 'Just one-shot a sensible default']
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
- ❌ `recall_includes_doctrine_any` — wanted any of: ['persona-design-best-practices', 'athena-usecases']; got titles: []

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

    docs/tests/athena/results/2026-05-26-2156/verdicts/design-family/t0-t1_open_design_ask.json

matching the schema in the playbook §"Verdict file format".
