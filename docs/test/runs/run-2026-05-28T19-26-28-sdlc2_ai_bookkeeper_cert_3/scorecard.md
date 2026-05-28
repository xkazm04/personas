# Scorecard (deterministic, provisional) — run-2026-05-28T19-26-28-sdlc2_ai_bookkeeper_cert_3

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-3 · **Provisional verdict:** `NOT-READY` · **team score:** 63

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 17 | 1/6 members executed |
| Work density | 50 | 1/2 executions completed (no retries/noops) |
| Handoff health | 100 | 1/1 events delivered |
| Learning loop | 50 | 0 reviews + 1 learned memories |
| **Grounding gate** | 97 | cited file paths that actually exist, across 3 doc artifacts |
| **Code-track §1.A** | FAIL | build=pass · lint=fail · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `CHANGELOG.md` — 2/2 cited paths exist (100%)
- `README.md` — 7/7 cited paths exist (100%)
- `docs/adr/0005-money-formatting-consolidation.md` — 9/10 cited paths exist (90%) · unresolved: wealth-score/WealthScoreCard.tsx

## Facts
```json
{
  "executions": 2,
  "completed": 1,
  "failed": 1,
  "cascade_stalled": true,
  "value_delivered": 1,
  "personasExecuted": 1,
  "memberCount": 6,
  "eventsDelivered": 1,
  "reviews": 0,
  "pendingReviews": 0,
  "learnedMemories": 1,
  "cost_usd": 1.0546562499999999,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
