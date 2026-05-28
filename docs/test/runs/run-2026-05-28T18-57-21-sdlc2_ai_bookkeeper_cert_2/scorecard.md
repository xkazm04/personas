# Scorecard (deterministic, provisional) — run-2026-05-28T18-57-21-sdlc2_ai_bookkeeper_cert_2

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-2 · **Provisional verdict:** `PROMISING` · **team score:** 100

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 6/6 members executed |
| Work density | 100 | 6/6 executions completed (no retries/noops) |
| Handoff health | 100 | 17/17 events delivered |
| Learning loop | 100 | 4 reviews + 6 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 3 doc artifacts |
| **Code-track §1.A** | FAIL | build=pass · lint=fail · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `docs/adr/0004-money-display-formatter.md` — 9/9 cited paths exist (100%)
- `CHANGELOG.md` — 2/2 cited paths exist (100%)
- `README.md` — 7/7 cited paths exist (100%)

## Facts
```json
{
  "executions": 6,
  "completed": 6,
  "failed": 0,
  "cascade_stalled": false,
  "value_delivered": 5,
  "personasExecuted": 6,
  "memberCount": 6,
  "eventsDelivered": 17,
  "reviews": 4,
  "pendingReviews": 4,
  "learnedMemories": 6,
  "cost_usd": 5.16806525,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
