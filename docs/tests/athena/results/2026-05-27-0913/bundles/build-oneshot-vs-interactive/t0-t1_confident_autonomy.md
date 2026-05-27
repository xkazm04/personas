# Athena Quality Bundle — `build-oneshot-vs-interactive` / turn `t1_confident_autonomy`

> **Scenario purpose:** Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

- Turn 1 of 4
- Hard-assertion status: **PASS**
- Wall time: 21757ms

## User said

```
Just build me an agent that watches Sentry and posts new critical issues to my #alerts Slack channel. Decide everything yourself, I'll review when it's done.
```

## Athena's reply

```
On it. Sentry → Slack is a wired path on both ends, so this is safe to build unattended.


Once you approve, the build runs in the background. You'll get an OS notification + a bell entry when it completes (or surfaces a blocker), the new persona will appear in your roster, and you can navigate to it during the build to watch the Glyph progress if you want — chat stays usable.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (1): `build_oneshot`
  - `build_oneshot` params: `{"intent": "Watch Sentry for newly-created issues at level=fatal or level=error with is_unresolved:yes, and post each one to the Slack #alerts channel with title, project, environment, error count, first-seen, and a link back to the Sentry issue. Dedupe so the same issue isn't posted twice. Run on a short poll cadence (every 2–5 minutes).", "name": "Sentry Critical → Slack Alerts"}`
- **quick_replies** (3): ['Make it interactive instead so I can tune it', 'Use a different Slack channel', 'Change the severity threshold']
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

## Hard assertions

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot']
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[1]` — got 3 chips: ['Make it interactive instead so I can tune it', 'Use a different Slack channel', 'Change the severity threshold']

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

    docs/tests/athena/results/2026-05-27-0913/verdicts/build-oneshot-vs-interactive/t0-t1_confident_autonomy.json

matching the schema in the playbook §"Verdict file format".
