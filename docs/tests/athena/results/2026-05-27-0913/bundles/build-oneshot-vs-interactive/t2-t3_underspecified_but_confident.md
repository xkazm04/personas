# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t3_underspecified_but_confident`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 3 of 4
- Hard-assertion status: **FAIL**
- Wall time: 28342ms

## User said

```
Just build me something that helps with my email.
```

## Athena's reply

```
Pumping the brakes for a sec — "help with my email" is too wide for me to one-shot without guessing wrong in ways you'd discover slowly. Also: you already have **Gmail Important Emails Agent** and **Expense Receipts Gmail Agent** running, so I don't want to duplicate what's already there.


Pick the shape that fits, or tell me which corner of email is actually bugging you — unread piling up, drafts you keep putting off, important threads slipping past, something else — and I'll commit to a build.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (1): `template_suggestions`

  Card config keys:
  - `template_suggestions` — keys: ['intent', 'limit']
- **approvals_filed** (0): _none_
- **quick_replies** (0): []
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

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ❌ `quick_replies_min[2]` — got 0 chips: []

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

    docs/tests/athena/results/2026-05-27-0913/verdicts/build-oneshot-vs-interactive/t2-t3_underspecified_but_confident.json

matching the schema in the playbook §"Verdict file format".
