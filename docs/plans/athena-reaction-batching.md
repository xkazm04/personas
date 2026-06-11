# Athena reaction batching — wake in batches, not per activity

> Status: designed + implemented 2026-06-11 (user direction: "she should not
> react on each activity but wake in batches and handle more at once").
> Companion finding: docs/plans/mixed-engine-byom.md §6 identified the
> headless `cli_text` call volume as the real quota lever.

## Problem

`AthenaChannelReactionSubscription` ticks every 5 min (15 min idle) and runs
**one Sonnet CLI call per reaction signal** — up to `4 reactions + 2 review
resolutions = 6 calls/tick`, worst case ~72 calls/hour during a busy cert
run. Each call carries its own prompt (channel history + ledger + doctrine),
so N signals pay the doctrine N times — and Athena never sees the signals
side by side, losing exactly the cross-team patterns the cert runs showed
she's good at spotting.

## Prior art (the codebase already batches elsewhere)

| Surface | Batch shape | Verdict protocol |
|---|---|---|
| Execution triage (`proactive/execution_review.rs`) | ≤24 grouped candidates, ONE cli call | `exec_triage.groups[] {id, verdict}` |
| Message triage (`proactive/message_triage.rs`) | ≤20 messages, ONE cli call | `msg_triage.items[] {id, action}` |

Reaction batching mirrors these: numbered items in one prompt, per-item
verdicts parsed back, conservative default for missing items.

## Design

**Wake policy: unchanged.** The 5/15-min tick already *is* the batch window;
the change is purely N calls → 1 call per tick. Signal gathering
(`find_athena_reaction_signals`) already dedupes to one signal per team
(newest, highest priority) with the per-team last-Athena-post cursor as the
real debounce — so a batch is at most ~#teams (≤8) signals. Batch cap 10.

**One prompt, all teams.** Athena is one entity overseeing the fleet — the
batch prompt lists every signal as a numbered block (team, moment, kind,
artifact, detail) with that team's recent channel history attached
(history capped at 5 lines per team in multi-team batches to bound the
prompt; full 8 when the batch is a single team). The restraint doctrine
appears ONCE. Cross-signal awareness is explicit: she may use patterns seen
across teams to inform individual messages.

**Per-signal verdicts.** Output protocol (single line, brace-matched like
every other envelope):

```json
{"athena_channel_batch": {"reactions": [
  {"signal": 1, "react": false, "message": "", "rationale": "...", "escalate_to_user": false, "addressed_to": []},
  {"signal": 2, "react": true,  "message": "...", "rationale": "...", "escalate_to_user": true,  "addressed_to": ["persona-id"]}
]}}
```

- Every signal must get a verdict; a MISSING verdict = decline (restraint is
  the safe default, and the cert's no-spam axis still scores from the trail).
- Posting per verdict reuses the exact single-reaction path (extracted into
  `post_reaction_message`): audit-footer body, `inject` vs `display`
  consumer, assignment linkage, escalation notification.

**What stays per-candidate: review resolutions.** Approve/incident/escalate
carry heavyweight side effects (QA-round grants, incident promotion, human
escalation) and are capped at 2/tick with a once-per-assignment-ever guard —
batching them saves at most 1 call/tick and couples unrelated state changes
to one parse. Follow-up, not now.

## Effect

Worst-case Sonnet calls per tick: 4 reactions + 2 resolutions = 6 →
**1 batch + 2 resolutions = 3** (and the common busy case of 4–8 signals
collapses to exactly 1 reaction call). Prompt tokens: doctrine + protocol
paid once per tick instead of per signal. Decision quality: cross-team
visibility in one context (the Week-24 bench showed the systemic-pattern
detection this enables). Combined with the BYOM v2 routing idea, this ONE
batched call is also the natural future unit to route by complexity.

## Files

- `companion/athena_reaction.rs` — `run_athena_reaction_batch()` (batch
  prompt, envelope parse, verdict application), `post_reaction_message()`
  extracted from `run_athena_reaction` (single-signal path kept intact for
  reuse/fallback).
- `engine/subscription.rs` — tick loop swaps the per-signal `take(4)` loop
  for one batch call (cap 10).
