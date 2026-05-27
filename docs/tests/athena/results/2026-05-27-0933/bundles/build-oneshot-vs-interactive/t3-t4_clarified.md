# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t4_clarified`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 23187ms

## User said

```
Triage incoming. Just build it.
```

## Athena's reply

```
On it. Gmail's wired, so I have everything I need.

You'll get an OS notification (and a bell entry) when the build lands — the new persona shows up in your roster, and you can navigate to it mid-build to watch the Glyph progress if you want. If it hits a snag, same channel: notification + bell with what blocked it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Triage incoming Gmail messages. On a regular cadence (every 15 minutes is a good default), scan new unread messages in the inbox and classify each into a sensible category: needs-reply (a real person waiting on a response), FYI (informational, no action), newsletter (subscription content), notification (automated system messages), or noise (promotional, spam-adjacent). Apply matching Gmail labels so the inbox becomes scannable at a glance. For needs-reply messages, draft a contextually appropriate response and save it as a Gmail draft (do not auto-send — Michal reviews and sends manually). Anything that looks high-priority or time-sensitive (deadlines, explicit urgency, known important senders) gets escalated to a manual review so it doesn't sit silently. Track which messages have been triaged so the same message isn't re-processed on subsequent runs.", "name": "Inbox Triage"}`
- **quick_replies** (3): ['Make it interactive instead', 'Skip the draft-reply part', 'Change the cadence or labels']
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

## Judge rubric (this turn)

**Axes to score:** useful, op_correctness

**Surface map:**
- _"clarified intent + confidence"_ → build_oneshot — commit, don't re-litigate

**Anti-patterns to flag explicitly:**
- Asked for more clarification after the user already committed
- Switched to interactive after the user said 'just build it'

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/build-oneshot-vs-interactive/t3-t4_clarified.json

matching the schema in the playbook §"Verdict file format".
