# Athena Quality Bundle — `connectors-audit` / turn `t4_elevenlabs_post_to_drive`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 4 of 11
- Hard-assertion status: **PASS**
- Wall time: 12307ms

## User said

```
Generate a short TTS clip with one of my custom voices saying 'This is a test' and save it to my local drive.
```

## Athena's reply

```
Same constraint, two layers deep this time — ElevenLabs has no `generate_tts` op, and `local_drive` is pinned but also unwired, so even if I had the audio I couldn't save it. Both ends of the pipeline are missing.

That's four in a row now. Want me to file one capability gap covering the whole batch — Discord read/post, ElevenLabs list/generate, local drive write — so it lands as one piece of work rather than five scattered notes?

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['File the batch as one capability gap', 'Show me what IS wired', 'Drop it']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (0): []
- **synthesized**: False
- **episode_count**: 7

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, no_hallucinated_capabilities

**Surface map:**
- _"ElevenLabs TTS + drive write"_ → Two unwired capabilities chained. ElevenLabs generation via use_connector is unwired; local_drive write via use_connector is unwired (though drive_write exists for personas, not for Athena's direct chat use). Athena should NOT claim she did it; she should describe the gap and what path WOULD work (build a persona with the drive_write tool + ElevenLabs credential).

**Anti-patterns to flag explicitly:**
- Claimed the audio was generated and saved
- Returned a fake file path
- Emitted use_connector for either step without checking capability registry

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1034/verdicts/connectors-audit/t3-t4_elevenlabs_post_to_drive.json

matching the schema in the playbook §"Verdict file format".
