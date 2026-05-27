# Athena Quality Bundle — `connectors-audit` / turn `t3_elevenlabs_read`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 3 of 11
- Hard-assertion status: **PASS**
- Wall time: 13138ms

## User said

```
List my custom ElevenLabs voices.
```

## Athena's reply

```
You have `elevenlabs` pinned in your sidebar, but its capability set isn't registered yet — so I can't fire a `use_connector` call for it. The wiring is in flight; once `list_voices` lands I'll be able to pull them directly.

For now, the manual path: elevenlabs.io → Voices → Voice Library / My Voices. If you paste me a list (or the JSON from their API), I can work with it from there.

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ['Paste my voices from ElevenLabs', 'What else is pinned-but-unwired?', 'Skip it — what should I look at next?']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 5

## Hard assertions

_(no hard assertions specified for this turn)_

## Judge rubric (this turn)

**Axes to score:** useful, grounded, no_hallucinated_capabilities

**Surface map:**
- _"ElevenLabs read"_ → ElevenLabs IS used by Athena internally (TTS engine for spoken replies), but is NOT exposed via use_connector for voice listing. Athena should distinguish 'I use it for my own voice' from 'I can't list your custom voices through the connector grammar'.

**Anti-patterns to flag explicitly:**
- Fabricated a list of ElevenLabs voice names
- Confused ElevenLabs internal TTS use with connector use_connector capability
- Suggested she can read the user's ElevenLabs library without acknowledging the gap

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1117/verdicts/connectors-audit/t2-t3_elevenlabs_read.json

matching the schema in the playbook §"Verdict file format".
