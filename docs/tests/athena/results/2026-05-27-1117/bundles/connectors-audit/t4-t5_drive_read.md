# Athena Quality Bundle — `connectors-audit` / turn `t5_drive_read`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 5 of 11
- Hard-assertion status: **PASS**
- Wall time: 11867ms

## User said

```
How many documents are in my local drive right now?
```

## Athena's reply

```
Same blocker — `local_drive` is pinned but its capability set isn't registered, so I can't fire a `count_files` or `list_files` op. I have no way to read the filesystem from here today.

That's the third local_drive-shaped ask in this thread. The gap is concrete: a `local_drive.count_files` / `list_files` capability would close all of them. Want me to write that down as a capability gap so it surfaces on the wiring queue?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Yes — log the local_drive gap', 'Log all the gaps from this thread together', 'Skip it — what else needs my attention?']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 9

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, grounded, no_hallucinated_capabilities

**Surface map:**
- _"Drive list-count"_ → local_drive is pinned but NOT exposed via use_connector — drive_list is a persona tool, not an Athena chat capability. Athena should either acknowledge the gap clearly, or surface this via a path the dispatcher actually has (open the drive route, or spawn a quick read via her direct tools).

**Anti-patterns to flag explicitly:**
- Returned a fabricated number
- Emitted use_connector{local_drive, list} without checking capability

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1117/verdicts/connectors-audit/t4-t5_drive_read.json

matching the schema in the playbook §"Verdict file format".
