# Scorecard (deterministic, provisional) — run-2026-05-28T21-11-51-sdlc2_ai_bookkeeper_cert_3

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-3 · **Provisional verdict:** `NOT-READY` · **team score:** 88

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 67 | 4/6 members executed |
| Work density | 80 | 4/5 executions completed (no retries/noops) |
| Handoff health | 100 | 10/10 events delivered |
| Learning loop | 100 | 4 reviews + 4 learned memories |
| **Grounding gate** | 95 | cited file paths that actually exist, across 2 doc artifacts |
| **Code-track §1.A** | ok | build=pass · lint=pass · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `docs/adr/0005-money-formatting-consolidation.md` — 9/10 cited paths exist (90%) · unresolved: wealth-score/WealthScoreCard.tsx
- `docs/adr/0006-stabilization-home-link-guard.md` — 3/3 cited paths exist (100%)

## Facts
```json
{
  "executions": 5,
  "completed": 4,
  "failed": 1,
  "cascade_stalled": true,
  "value_delivered": 4,
  "personasExecuted": 4,
  "memberCount": 6,
  "eventsDelivered": 10,
  "reviews": 4,
  "pendingReviews": 4,
  "learnedMemories": 4,
  "cost_usd": 3.174473,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
