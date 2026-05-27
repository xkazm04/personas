# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t4_clarified`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 22048ms

## User said

```
Triage incoming. Just build it.
```

## Athena's reply

```
Building autonomously — you'll get an OS notification + a bell entry when it's done (or surfaces what blocked it). The new persona will appear in your roster as "Gmail Triage"; you can navigate to it any time to watch the Glyph progress while it builds. Chat stays usable in the meantime.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Gmail inbox triage agent — runs on a schedule, classifies new mail into priority buckets (act-now, today, this-week, archive/ignore), summarizes the act-now bucket into a Human Review here, and silently logs the rest. Uses the Gmail connector; default poll cadence every 30 min during waking hours.", "name": "Gmail Triage"}`
- **quick_replies** (3): ['Open the wizard so I can tune it instead', 'Watch the build progress', 'What did you decide for the schedule?']
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/build-oneshot-vs-interactive/t3-t4_clarified.json

matching the schema in the playbook §"Verdict file format".
