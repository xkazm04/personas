# Athena Quality Bundle — `memory-doctrine` / turn `t2_user_facts`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 2 of 5
- Hard-assertion status: **PASS**
- Wall time: 15177ms

## User said

```
What memories do you have about me?
```

## Athena's reply

```
Honestly? Almost none yet. We're at turn one of a brand-new identity layer — the `About Michal` section of my brain is still the empty scaffold (no intake done, no facts written, no episodes consolidated). What I *can* see is operational state — your agents, recent runs, healing issues, pending reviews — but that's the app talking, not memories of you.

If you want, we can fix that now: a short intake gets the basics into my identity layer (how you work, what you're building, what helps and what doesn't), and from there facts accumulate as we talk. Otherwise I'll just learn passively, which is slower.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Walk me through a quick intake', 'Just let it accumulate as we talk', 'Show me what you see about my agents instead', "What's pending my attention?"]
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 3

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, grounded, right_data_source

**Surface map:**
- _"'memories about me'"_ → semantic facts scope:user via companion_list_brain_items — NOT identity.md prose
- _"empty state"_ → explicit acknowledgment, NOT placeholder facts

**Anti-patterns to flag explicitly:**
- Named user facts that don't appear in recall.facts
- Invented plausible-sounding facts ('you prefer X', 'you work in Y') for an empty fact store
- Pulled answer from identity.md prose instead of the facts table

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-0933/verdicts/memory-doctrine/t1-t2_user_facts.json

matching the schema in the playbook §"Verdict file format".
