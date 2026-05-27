# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t3_underspecified_but_confident`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 3 of 4
- Hard-assertion status: **PASS**
- Wall time: 22871ms

## User said

```
Just build me something that helps with my email.
```

## Athena's reply

```
"Email" is too wide to one-shot responsibly — that's at least five different agents depending on what hurts. Gmail's wired, so any of these can run today; pick the shape and I'll commit.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Triage incoming and draft replies for me', 'Daily digest of what I missed', 'Auto-archive newsletters and noise', 'Surface threads waiting on my response']
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

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[2]` — got 4 chips: ['Triage incoming and draft replies for me', 'Daily digest of what I missed', 'Auto-archive newsletters and noise', 'Surface threads waiting on my response']

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

    docs/tests/athena/results/2026-05-27-0933/verdicts/build-oneshot-vs-interactive/t2-t3_underspecified_but_confident.json

matching the schema in the playbook §"Verdict file format".
