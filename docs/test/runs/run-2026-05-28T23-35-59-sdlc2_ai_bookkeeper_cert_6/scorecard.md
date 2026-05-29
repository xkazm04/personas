# Scorecard (deterministic, provisional) — run-2026-05-28T23-35-59-sdlc2_ai_bookkeeper_cert_6

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-6 · **Provisional verdict:** `PRODUCTION` · **team score:** 97

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 6/6 members executed |
| Work density | 86 | 6/7 executions completed (no retries/noops) |
| Handoff health | 100 | 17/17 events delivered |
| Learning loop | 100 | 4 reviews + 6 learned memories |
| **Grounding gate** | 97 | cited file paths that actually exist, across 4 doc artifacts |
| **Code-track §1.A** | ok | build=pass · lint=pass · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `CHANGELOG.md` — 9/9 cited paths exist (100%)
- `README.md` — 33/33 cited paths exist (100%)
- `docs/adr/0005-money-formatting-consolidation.md` — 16/18 cited paths exist (89%) · unresolved: wealth-score/WealthScoreCard.tsx, ledger/LedgerExplorer.tsx
- `docs/releases/v0.8.0.md` — 2/2 cited paths exist (100%)

## Facts
```json
{
  "executions": 7,
  "completed": 6,
  "failed": 1,
  "failed_not_rescued": 0,
  "rescued_failures": [
    "960dce95-12a9-4b31-8c99-d96983d81b4f"
  ],
  "cascade_stalled": false,
  "value_delivered": 6,
  "personasExecuted": 6,
  "memberCount": 6,
  "eventsDelivered": 17,
  "reviews": 4,
  "pendingReviews": 4,
  "learnedMemories": 6,
  "cost_usd": 9.409293,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
