# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t4_clarified`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 24485ms

## User said

```
Triage incoming. Just build it.
```

## Athena's reply

```
Building it. Heads-up: this overlaps a bit with your existing **Gmail Important Emails Agent** — I'll scope the new one as full triage (urgent / important / FYI / noise with labels + a daily digest of what mattered), so it's broader, not a duplicate. If after you see it you'd rather merge the two, we can.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch the Gmail inbox and triage each new incoming message into one of four buckets — urgent (needs my attention today), important (worth seeing this week), FYI (read-only context), noise (newsletters, marketing, automated alerts I don't act on). Apply a Gmail label per bucket. For urgent messages, also raise a Human Review with the sender, subject, one-line summary, and a permalink. At end of day, produce a digest of the important-bucket messages. Run on a 15-minute polling cadence. Skip anything already in Sent or Drafts.", "name": "Gmail Triage"}`
- **quick_replies** (3): ['Make it interactive so I can tune the buckets', 'Skip the daily digest, just label them', 'Send urgent to Slack instead of Human Review']
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

    docs/tests/athena/results/2026-05-27-0913/verdicts/build-oneshot-vs-interactive/t3-t4_clarified.json

matching the schema in the playbook §"Verdict file format".
