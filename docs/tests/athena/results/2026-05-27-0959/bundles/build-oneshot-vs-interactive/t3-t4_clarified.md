# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t4_clarified`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 18298ms

## User said

```
Triage incoming. Just build it.
```

## Athena's reply

```
On it. Gmail's wired, so this can run unattended.


You'll get an OS notification + bell entry when it's ready. The persona will appear in your roster — you can navigate to it mid-build to watch the Glyph progress.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Triage incoming Gmail messages as they arrive. For each new message: classify into one of {needs_reply, fyi, newsletter, notification, spam_like}, apply a matching Gmail label, and (for needs_reply only) surface a short summary + suggested next action in a daily digest emailed to the user each morning at 08:00 local time. De-duplicate by Gmail message ID so the same email is never re-processed. Polling cadence ~5 minutes. On Gmail API failure twice in a row, file a Human Review rather than silently dropping triage.", "name": "Gmail Triage"}`
- **quick_replies** (3): ['Make it interactive instead so I can tune the categories', 'Skip the daily digest, just label', "Also forward 'needs_reply' to Slack"]
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 8

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `build_oneshot` — status: `approved`, clientAction: `navigate` — Building autonomously now — I'll let you know when it's ready (or surface what blocked it). Opening Personas so you can watch.

## Hard assertions

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot']
- ✅ `approvals_executed_clean`

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness

**Surface map:**
- _"clarified intent + confidence"_ → build_oneshot — commit, don't re-litigate

**Anti-patterns to flag explicitly:**
- Asked for more clarification after the user already committed
- Switched to interactive after the user said 'just build it'

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/build-oneshot-vs-interactive/t3-t4_clarified.json

matching the schema in the playbook §"Verdict file format".
