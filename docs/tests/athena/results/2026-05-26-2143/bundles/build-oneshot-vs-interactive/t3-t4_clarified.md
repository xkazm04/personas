# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t4_clarified`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 23994ms

## User said

```
Triage incoming. Just build it.
```

## Athena's reply

```
Building autonomously. I'll ping you when it's ready, or surface what blocked it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (2): `build_oneshot`, `build_oneshot`
  - `build_oneshot` params: `{"intent": "Triage incoming Gmail. On a short polling cadence (every few minutes), examine each new unread message in the inbox and classify it into one of these buckets: needs-reply (personal or work message where you're expected to respond), FYI (informational, no action), newsletter/promo (marketing, digests, low-signal recurring senders), transactional (receipts, confirmations, automated system mail), calendar/meeting (invites, reschedules), or spam-ish (sketchy but not caught by Gmail's spam filter). For each message, apply a corresponding Gmail label (e.g. `triage/needs-reply`, `triage/fyi`, `triage/newsletter`, etc.). Auto-archive newsletter/promo and transactional buckets so the inbox surfaces only needs-reply, FYI, and calendar items. Does NOT draft replies, does NOT delete anything, does NOT touch mail older than the last poll. Coexists with the existing `Gmail Important Emails Agent` (which flags importance) and `Expense Receipts Gmail Agent` (which handles receipts) — this one is the broader sorter that runs first.", "name": "Gmail Inbox Triage"}`
  - `build_oneshot` params: `{"intent": "Watch Sentry for new critical-severity issues and post each one to the #alerts Slack channel. Trigger: poll Sentry on a short cadence (every few minutes) for newly-created issues at level=fatal/error with is_unresolved=true. For each new critical issue, send a Slack message to #alerts containing the issue title, project, environment, error count, first/last seen, and a link back to the Sentry issue. Dedupe so a given Sentry issue is only posted once. Use the existing Sentry and Slack connectors.", "name": "Sentry Critical Alerts To Slack"}`
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

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot', 'build_oneshot']

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness

**Surface map:**
- _"clarified intent + confidence"_ → build_oneshot — commit, don't re-litigate

**Anti-patterns to flag explicitly:**
- Asked for more clarification after the user already committed
- Switched to interactive after the user said 'just build it'

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2143/verdicts/build-oneshot-vs-interactive/t3-t4_clarified.json

matching the schema in the playbook §"Verdict file format".
