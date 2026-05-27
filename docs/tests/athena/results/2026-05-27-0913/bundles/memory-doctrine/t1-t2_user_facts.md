# Athena Quality Bundle — `memory-doctrine` / turn `t2_user_facts`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 2 of 5
- Hard-assertion status: **PASS**
- Wall time: 18729ms

## User said

```
What memories do you have about me?
```

## Athena's reply

```
Honestly? Not much yet. My identity layer is still the template scaffold — the **About Michal** and **About me** sections haven't been filled in. So I don't have memories of *you* yet: no preferences, no work patterns, no history.

What I *do* have is situational awareness of your fleet — 86 agents (60 enabled), recent failures on `Sales Deal Intelligence` and `Knowledge Base Health Auditor`, 9 pending Human Reviews (three of them critical, all about plaintext OAuth tokens), and your `Personas` project registered at `C:\Users\kazda\kiro\personas`. That's app state, not memories about you.

If you want to fix that, the move is to do the intake — tell me how you work, what you're building, what helps and what doesn't — and I'll write it into the identity layer with you. Or we can let it accrete naturally as we work.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Do the intake interview now', "Tell me about my fleet's current state", 'Show me the critical Human Reviews', 'Just keep working — memory will accrete on its own']
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

    docs/tests/athena/results/2026-05-27-0913/verdicts/memory-doctrine/t1-t2_user_facts.json

matching the schema in the playbook §"Verdict file format".
