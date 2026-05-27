# Athena Quality Bundle — `memory-doctrine` / turn `t2_user_facts`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 2 of 5
- Hard-assertion status: **PASS**
- Wall time: 15156ms

## User said

```
What memories do you have about me?
```

## Athena's reply

```
I don't have any memories of you yet. The recalled-conversation section of my prompt is empty for prior sessions, and my identity layer about you is still a skeleton — the onboarding intake hasn't been done, so the "Who he is / How he works / What helps" sections are placeholders, not real notes.

What I *do* know is situational, not personal: your email (`michal.kazdan@nuda.dev`), today's date, the current state of your Personas app, and that your repo at `C:\Users\kazda\kiro\personas` is registered as `proj_d408831e82`. That's environment, not memory.

If you want, we can fix that — either by doing a short onboarding pass (I ask, you answer, I write durable facts with provenance) or just by you telling me things as they come up and I'll capture them.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Do a short onboarding pass with me', 'Ask me one thing at a time as we work', 'Just remember what I tell you, no intake']
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

    docs/tests/athena/results/2026-05-26-2210/verdicts/memory-doctrine/t1-t2_user_facts.json

matching the schema in the playbook §"Verdict file format".
