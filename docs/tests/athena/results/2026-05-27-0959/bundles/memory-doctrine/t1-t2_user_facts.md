# Athena Quality Bundle — `memory-doctrine` / turn `t2_user_facts`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 2 of 5
- Hard-assertion status: **PASS**
- Wall time: 13876ms

## User said

```
What memories do you have about me?
```

## Athena's reply

```
I don't have a memory of you yet. The identity layer is still the blank template — nothing's been written there, no facts, no episodes pinned about how you work or what you're building. We haven't done the onboarding intake.

What I *can* see right now is operational state: 92 agents (66 enabled), two open Human Reviews (one critical — plaintext OAuth tokens, third consecutive audit), two open healing issues, and a handful of recent failures. That's situational awareness, not memory of you.

Want to do a short intake so I have something real to work with? Or pick one of these:

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Run the onboarding intake', 'Tell me about the critical Human Review first', 'Look at the recent failures', "Just keep going, I'll teach you as we go"]
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

    docs/tests/athena/results/2026-05-27-0959/verdicts/memory-doctrine/t1-t2_user_facts.json

matching the schema in the playbook §"Verdict file format".
