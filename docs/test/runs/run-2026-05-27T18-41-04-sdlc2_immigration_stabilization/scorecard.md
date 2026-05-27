# Scorecard (deterministic, provisional) — run-2026-05-27T18-41-04-sdlc2_immigration_stabilization

**Team:** SDLC2 — Immigration · **Seed:** sdlc2/immigration-stabilization · **Provisional verdict:** `NOT-READY` · **team score:** 91

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 83 | 5/6 members executed |
| Work density | 71 | 5/7 executions completed (no retries/noops) |
| Handoff health | 100 | 15/15 events delivered |
| Learning loop | 100 | 3 reviews + 5 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 3 doc artifacts |

## Grounding detail (the anti-eloquence gate)
- `docs/adr/0002-criteria-row-tone-and-derived-counts.md` — 3/3 cited paths exist (100%)
- `README.md` — 5/5 cited paths exist (100%)
- `docs/adr/0001-criteria-status-aggregation.md` — 6/6 cited paths exist (100%)
- `docs/backlog-brainstorm.md` — 0/0 cited paths exist (n/a%)

## Facts
```json
{
  "executions": 7,
  "completed": 5,
  "failed": 2,
  "cascade_stalled": true,
  "value_delivered": 4,
  "personasExecuted": 5,
  "memberCount": 6,
  "eventsDelivered": 15,
  "reviews": 3,
  "pendingReviews": 3,
  "learnedMemories": 5,
  "cost_usd": 2.9878530000000003,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
