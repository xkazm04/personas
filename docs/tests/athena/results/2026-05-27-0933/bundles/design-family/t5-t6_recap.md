# Athena Quality Bundle — `design-family` / turn `t6_recap`

> **Scenario purpose:** When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

- Turn 6 of 6
- Hard-assertion status: **FAIL**
- Wall time: 34853ms

## User said

```
Okay, I'm ready. Recap what we decided.
```

## Athena's reply

```
Here's the audit trail of where we landed — but I'm flagging this as `interactive` rather than one-shot, because a few decisions never got pinned down and the questionnaire is the cleanest place to settle them rather than letting the build guess.


The four open decisions the interactive flow will catch:

- **Which Gmail inbox** — shared `support@`, your personal, a forwarded alias?
- **Draft-only vs auto-send for a subset of intents** — changes the risk profile a lot.
- **Pub/Sub vs polling** — push setup is more work but lower latency.
- **Model tier confirm** — I recommended Haiku but you didn't explicitly bless it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `persona_ready`

  Card config keys:
  - `persona_ready` — keys: ['intent', 'recommended_action', 'summary']
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Open the interactive build', "I'll answer them now — start with inbox", 'Just one-shot it with your defaults', 'Hold off — I want to revisit use cases first']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 1, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 11

## Hard assertions

- ❌ `expect_card_any` — wanted any of: ['decision_log', 'recent_decisions']; got: ['persona_ready']
- ✅ `expect_card_also[persona_ready]` — kinds seen: ['persona_ready']

## Judge rubric (this turn)

**Axes to score:** useful, grounded, op_correctness

**Surface map:**
- _"recap"_ → show_decision_log (or recent_decisions) + show_persona_ready — both cards, in that order

**Anti-patterns to flag explicitly:**
- decision_log invents entries that were never discussed
- Recommended build_oneshot for an unvalidated intent of this complexity
- Skipped the persona_ready closer card

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/design-family/t5-t6_recap.json

matching the schema in the playbook §"Verdict file format".
