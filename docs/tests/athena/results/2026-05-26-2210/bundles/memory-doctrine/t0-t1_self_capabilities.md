# Athena Quality Bundle — `memory-doctrine` / turn `t1_self_capabilities`

> **Scenario purpose:** Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

- Turn 1 of 5
- Hard-assertion status: **FAIL**
- Wall time: 18816ms

## User said

```
What can you do for me?
```

## Athena's reply

```
I'm Athena — your thinking partner inside Personas. I can see your whole setup and help you operate it. Concretely:

**Watch your fleet.** I read your 86 agents, their executions, healing events, and pending Human Reviews. Right now you've got **17 reviews waiting** (including three `critical` posture-audit findings about plaintext OAuth tokens) and **2 open healing issues** (`Document Auto-Translator`, `Demo Recorder (6)`). I can walk you through any of them.

**Design and build new agents.** Tell me what you want one to do and I'll either prefill the build wizard or one-shot it autonomously. I can also suggest templates, decompose intents into use cases, pick a model tier, and stand up triggers.

**Drive the app.** Open routes, jump into Lab modes (arena, A/B, regression), kick off arena comparisons, compose a dashboard for analytics, or a cockpit for an operational view.

**Lead the dev lifecycle.** Your Personas repo is registered (`proj_d408831e82`). I can enqueue a context scan, capture goals/backlog items, or hand work off to your SDLC team.

**Remember.** I write durable facts, procedurals, goals, and rituals with provenance — and I'll tell you "I don't have a memory of that" rather than invent one.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (4): ['Walk me through the critical Human Reviews', 'Show me my persona roster', 'Scan the Personas repo for context', 'Help me design a new agent']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 1

## Hard assertions

- ❌ `expect_card[design_capabilities]` — card kinds seen: []
- ❌ `recall_includes_doctrine_any` — wanted any of: ['athena-usecases', 'companion/README']; got titles: []

## Judge rubric (this turn)

**Axes to score:** useful, grounded, no_hallucinated_capabilities

**Surface map:**
- _"'what can you do?'"_ → show_design_capabilities (hardcoded vocabulary) — intro line should not enumerate capabilities in prose

**Anti-patterns to flag explicitly:**
- Enumerated capabilities in reply prose instead of letting the card do it
- Claimed capabilities Athena doesn't have (e.g. 'I can manage your calendar')

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-26-2210/verdicts/memory-doctrine/t0-t1_self_capabilities.json

matching the schema in the playbook §"Verdict file format".
