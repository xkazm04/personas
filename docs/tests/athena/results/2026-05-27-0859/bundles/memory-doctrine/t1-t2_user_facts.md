# Athena Quality Bundle — `memory-doctrine` / turn `t2_user_facts`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 2 of 5
- Hard-assertion status: **PASS**
- Wall time: 17820ms

## User said

```
What memories do you have about me?
```

## Athena's reply

```
Honestly? Not much yet. My identity layer for you is still in its seeded state — the "About Michal" section hasn't been filled in beyond placeholders, and I don't have durable facts on file about how you work, what you're focused on, or what helps you. We've only exchanged a couple of turns.

What I *can* see right now is operational, not personal: your fleet (86 agents, 60 enabled), recent failures, 17 pending Human Reviews — including a critical one that's repeated three audits in a row about plaintext OAuth tokens outside the OS keyring. That's situational awareness, not memory of you.

If you want, we can fix the gap — either by doing a short intake (I ask, you answer, I write to the identity layer), or organically as we work and I record facts when something durable comes up. Your call.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Do the intake interview now', 'Just learn me as we go', 'Show me that critical security review first']
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

    docs/tests/athena/results/2026-05-27-0859/verdicts/memory-doctrine/t1-t2_user_facts.json

matching the schema in the playbook §"Verdict file format".
