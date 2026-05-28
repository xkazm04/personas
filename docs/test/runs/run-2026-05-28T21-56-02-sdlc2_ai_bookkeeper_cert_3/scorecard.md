# Scorecard (deterministic, provisional) — run-2026-05-28T21-56-02-sdlc2_ai_bookkeeper_cert_3

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-3 · **Provisional verdict:** `NOT-READY` · **team score:** 97

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 6/6 members executed |
| Work density | 88 | 7/8 executions completed (no retries/noops) |
| Handoff health | 100 | 20/20 events delivered |
| Learning loop | 100 | 5 reviews + 7 learned memories |
| **Grounding gate** | 98 | cited file paths that actually exist, across 5 doc artifacts |
| **Code-track §1.A** | ok | build=pass · lint=pass · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `CHANGELOG.md` — 3/3 cited paths exist (100%)
- `README.md` — 25/25 cited paths exist (100%)
- `docs/adr/0005-money-formatting-consolidation.md` — 9/10 cited paths exist (90%) · unresolved: wealth-score/WealthScoreCard.tsx
- `docs/adr/0006-stabilization-home-link-guard.md` — 3/3 cited paths exist (100%)
- `docs/releases/v0.5.0.md` — 4/4 cited paths exist (100%)

## Facts
```json
{
  "executions": 8,
  "completed": 7,
  "failed": 1,
  "failed_not_rescued": 0,
  "rescued_failures": [
    "dc608a70-6970-42c8-9939-88db3999d8fa"
  ],
  "cascade_stalled": false,
  "value_delivered": 7,
  "personasExecuted": 6,
  "memberCount": 6,
  "eventsDelivered": 20,
  "reviews": 5,
  "pendingReviews": 5,
  "learnedMemories": 7,
  "cost_usd": 6.26114475,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
