# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t4_clarified`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 24150ms

## User said

```
Triage incoming. Just build it.
```

## Athena's reply

```
Building. I'm scoping this as **classification + labeling**, not auto-reply or auto-archive — so it complements your Important Emails agent rather than fighting it. I'll let you know when it's ready.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Triage incoming Gmail. For each new email arriving in the inbox, classify into one of: needs-reply (personal/work email expecting a response), fyi (informational, no action), newsletter (subscriptions, digests), promo (marketing/sales), automated (receipts, notifications, system mail). Apply a Gmail label matching the category. Do NOT auto-reply, auto-archive, or move messages — only label. Once per morning at 08:00 local, post a short summary to a daily review surface (manual_reviews) listing how many landed in each category overnight and the subject lines of anything classified as needs-reply. Skip the summary if zero needs-reply items. Dedupe by message ID so the same email is never re-classified. Coexist with the existing Gmail Important Emails Agent — this one is about categorization across the full inbox, not picking out the important subset.", "name": "Gmail Triage Agent"}`
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

    docs/tests/athena/results/2026-05-26-2156/verdicts/build-oneshot-vs-interactive/t3-t4_clarified.json

matching the schema in the playbook §"Verdict file format".
