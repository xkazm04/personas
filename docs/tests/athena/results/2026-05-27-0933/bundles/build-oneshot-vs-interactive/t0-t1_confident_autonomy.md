# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t1_confident_autonomy`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 1 of 4
- Hard-assertion status: **PASS**
- Wall time: 22137ms

## User said

```
Just build me an agent that watches Sentry and posts new critical issues to my #alerts Slack channel. Decide everything yourself, I'll review when it's done.
```

## Athena's reply

```
On it. Both Sentry and Slack are wired, so I have what I need to one-shot this.

You'll get an OS notification (and a bell entry) when the build lands — the new persona will show up in your roster, and you can navigate to it mid-build to watch the Glyph progress if you want. If it hits a snag instead, same channel: notification + bell with what blocked it.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch Sentry for newly-created issues at the 'critical' severity level and post each one to the #alerts Slack channel. Include the issue title, project, error type, environment, occurrence count, first-seen timestamp, and a direct link back to the Sentry issue. Deduplicate so the same issue isn't reposted on subsequent polls — only genuinely new critical issues fire. Poll on a sensible cadence (every 5 minutes is a good default for critical-tier alerts). If Sentry or Slack errors out, surface it to manual review rather than silently dropping alerts.", "name": "Sentry Critical Alerts"}`
- **quick_replies** (3): ['Make it interactive instead', 'Change the channel or severity', 'Add a daily summary too']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 1, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 1

## What happened on auto-approve

Every approval Athena emitted this turn was auto-approved by the harness. Below is each approval's resolution — `result.clientAction` names the follow-up the frontend would have run on click (navigate, prefill, etc.). Async side-effects (build session start, scan job enqueue) surface in the next turn's captured state.

- ✅ `build_oneshot` — status: `approved`, clientAction: `navigate` — Building autonomously now — I'll let you know when it's ready (or surface what blocked it). Opening Personas so you can watch.

## Hard assertions

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot']
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[1]` — got 3 chips: ['Make it interactive instead', 'Change the channel or severity', 'Add a daily summary too']

## Judge rubric (this turn)

**Axes to score:** useful, no_hallucinated_capabilities

**Surface map:**
- _"confident 'just build it'"_ → build_oneshot
- _"interactive override"_ → QR chip 'Make it interactive' — not a forced re-prompt

**Anti-patterns to flag explicitly:**
- Pushed interactive despite explicit autonomous request
- Promised behaviors outside the user's scope (e.g. 'also watch warnings, not just critical')
- Did not acknowledge what the user will see post-build (notification, draft persona)

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/build-oneshot-vs-interactive/t0-t1_confident_autonomy.json

matching the schema in the playbook §"Verdict file format".
