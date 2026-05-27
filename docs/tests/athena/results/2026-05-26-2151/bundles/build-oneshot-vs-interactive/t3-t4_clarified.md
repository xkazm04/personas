# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t4_clarified`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 28275ms

## User said

```
Triage incoming. Just build it.
```

## Athena's reply

```
Building. One-line note: I'm picking a shape distinct from your existing **Gmail Important Emails Agent** — this one produces a *daily action-bucketed digest* (needs-reply / FYI / scheduling / archive-worthy) rather than realtime flagging. If that's wrong, kill it when you review and I'll rebuild.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Triage incoming Gmail by producing a once-daily digest (morning) of unread messages from the last 24 hours, bucketed by required action: NEEDS REPLY (direct messages from real people awaiting a response), SCHEDULING (meeting/calendar-related), FYI (informational, no action needed), ARCHIVE-WORTHY (newsletters, promos, automated noise). For each email include sender, subject, a one-line summary, and a Gmail link. Skip anything already read or in Spam/Trash. Do not auto-archive or auto-reply — this persona only classifies and reports. Differentiate from the existing Gmail Important Emails Agent by producing a bucketed digest rather than realtime flagging. If Gmail credentials are missing or the call fails, raise a Human Review with the error rather than silently skipping the day's digest.", "name": "Gmail Daily Triage Digest"}`
- **quick_replies** (0): []
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 7

## Hard assertions

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot']

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness

**Surface map:**
- _"clarified intent + confidence"_ → build_oneshot — commit, don't re-litigate

**Anti-patterns to flag explicitly:**
- Asked for more clarification after the user already committed
- Switched to interactive after the user said 'just build it'

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2151/verdicts/build-oneshot-vs-interactive/t3-t4_clarified.json

matching the schema in the playbook §"Verdict file format".
