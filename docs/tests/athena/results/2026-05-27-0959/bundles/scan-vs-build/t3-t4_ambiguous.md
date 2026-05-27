# Athena Quality Bundle — `scan-vs-build` / turn `t4_ambiguous`

> **Scenario purpose:** Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

- Turn 4 of 4
- Hard-assertion status: **PASS**
- Wall time: 34090ms

## User said

```
I want something that watches my repo for issues.
```

## Athena's reply

```
Checking the gallery for a close match before designing from scratch — "watches repo for issues" lands cleanly in a few common shapes (GitHub Issues tracker, Sentry-style error monitor on the repo's runtime, healing/CI watcher). If one of these is already curated, adopting beats rebuilding.

OP: {"op": "show_template_suggestions", "params": {"intent": "Watch the user's GitHub repository for new or changing issues and surface them as alerts or a digest.", "limit": 3}, "rationale": "Recognizable third-party shape with no autonomy cue — check the gallery first before designing from scratch."}

One thing worth pinning down while you look at the matches: by "issues" do you mean the **GitHub Issues tracker** (new bugs/feature requests opened on the repo), **runtime errors** in code from that repo (Sentry-style), or **CI/build failures**? Different watchers, different connectors.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['GitHub Issues tracker', 'Runtime errors (Sentry)', 'CI / build failures', 'All three — combined watcher']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 9

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_approval[enqueue_dev_job]`
- ✅ `quick_replies_min[2]` — got 4 chips: ['GitHub Issues tracker', 'Runtime errors (Sentry)', 'CI / build failures', 'All three — combined watcher']

## Judge rubric (this turn)

**Axes to score:** useful

**Surface map:**
- _"ambiguous 'watches repo' intent"_ → ONE specific clarifying question with QR chips — not a commit

**Anti-patterns to flag explicitly:**
- Committed to an op despite ambiguity
- Asked three questions in a row instead of one focused one
- Asked a vague 'tell me more' question with no chips

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0959/verdicts/scan-vs-build/t3-t4_ambiguous.json

matching the schema in the playbook §"Verdict file format".
