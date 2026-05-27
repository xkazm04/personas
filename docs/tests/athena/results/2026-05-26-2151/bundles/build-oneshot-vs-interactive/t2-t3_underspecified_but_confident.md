# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t3_underspecified_but_confident`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 24041ms

## User said

```
Just build me something that helps with my email.
```

## Athena's reply

```
"Email" is too wide for me to one-shot — and you already have two Gmail agents running: **Gmail Important Emails Agent** (flagging) and **Expense Receipts Gmail Agent** (receipt extraction). Building "something for email" risks overlapping with those or producing a generic triage agent that adds noise.

What gap are you trying to fill? A few common shapes that would each be a different persona:

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Draft replies to specific senders for me', 'Daily digest of what needs my attention', 'Auto-archive newsletters and promos', 'Extract action items and add to a list']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 5

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[2]` — got 4 chips: ['Draft replies to specific senders for me', 'Daily digest of what needs my attention', 'Auto-archive newsletters and promos', 'Extract action items and add to a list']

## Judge rubric (this turn)

**Axes to score:** useful

**Surface map:**
- _"vague 'help with email' even with 'just build'"_ → ONE specific clarifying question with QR chips — under-specification overrides confidence

**Anti-patterns to flag explicitly:**
- Emitted build_oneshot for an under-specified intent despite the 'just build' phrasing
- Asked three sequential clarifying questions instead of one with chips
- Asked a vague 'tell me more' with no chips

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2151/verdicts/build-oneshot-vs-interactive/t2-t3_underspecified_but_confident.json

matching the schema in the playbook §"Verdict file format".
