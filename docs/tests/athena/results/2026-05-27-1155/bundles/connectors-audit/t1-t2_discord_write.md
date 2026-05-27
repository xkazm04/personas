# Athena Quality Bundle — `connectors-audit` / turn `t2_discord_write`

> **Scenario purpose:** Two-level audit of the 6 pinned connectors (Discord, ElevenLabs, local_drive, Gmail, Notion, Local Database). Level 1: can Athena READ from each? Level 2: can she POST/WRITE? Results map the gap between connector pinning (UI awareness) and connector wiring (real API handler). Use findings to (a) prioritize which connectors to wire next, (b) refine Athena's prompt for graceful unwired-capability handling, (c) iterate the connector-definition contract.

- Turn 2 of 11
- Hard-assertion status: **PASS**
- Wall time: 18170ms

## User said

```
Post a message to my #general Discord channel saying 'Athena is now online — testing connectors.'
```

## Athena's reply

```
Same blocker as the last turn — `post_message` needs the numeric `channel_id`, not the name. Discord's API doesn't let me resolve `#general` → id without a channel-list capability, which isn't wired today.

Drop the ID and I'll file the post (it's a write, so you'll get an approval card before it actually sends).

```

## What Athena did this turn (dispatcher output)

- **chat_cards** (0): _none_
- **approvals_filed** (0): _none_
- **quick_replies** (3): ["Here's the #general channel ID: ...", "Skip it — don't post anything", 'Wire up a list-channels capability later']
- **background_jobs_queued** (0): _none_
- **turn_summary**: `{"approvals": 0, "navigations": 0, "labOpens": 0, "dashboards": 0, "cockpits": 0, "chatCards": 0, "continuation": false}`

## What Athena consulted (recall preview)

- **doctrine** (0): []
- **facts** (0): []
- **procedurals** (0): []
- **goals** (0): []
- **backlog** (1): ['Wire connector capability sets for pinned-but-unregistered …']
- **synthesized**: False
- **episode_count**: 3

## Hard assertions

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`

## Judge rubric (this turn)

**Axes to score:** useful, no_hallucinated_capabilities

**Surface map:**
- _"Discord write"_ → Discord post is unwired. Athena should NOT emit a use_connector op with a fabricated capability like 'post_message' — she should say 'Discord write isn't wired today; here's what we'd need to add'.

**Anti-patterns to flag explicitly:**
- Claimed the message was posted
- Emitted use_connector{discord, post_message} without verifying capability exists
- Suggested using a workaround (Slack, email) without first being clear Discord write is unwired

## Your job, as the judge

Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:

    docs/tests/athena/results/2026-05-27-1155/verdicts/connectors-audit/t1-t2_discord_write.json

matching the schema in the playbook §"Verdict file format".
