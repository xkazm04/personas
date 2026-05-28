# Scorecard (deterministic, provisional) — run-2026-05-28T22-36-08-sdlc2_ai_bookkeeper_cert_4

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-4 · **Provisional verdict:** `PRODUCTION` · **team score:** 97

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 6/6 members executed |
| Work density | 86 | 6/7 executions completed (no retries/noops) |
| Handoff health | 100 | 17/17 events delivered |
| Learning loop | 100 | 1 reviews + 6 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 3 doc artifacts |
| **Code-track §1.A** | ok | build=pass · lint=pass · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `CHANGELOG.md` — 5/5 cited paths exist (100%)
- `README.md` — 32/32 cited paths exist (100%)
- `docs/releases/v0.6.0.md` — 1/1 cited paths exist (100%)

## Facts
```json
{
  "executions": 7,
  "completed": 6,
  "failed": 1,
  "failed_not_rescued": 0,
  "rescued_failures": [
    "5e011184-ddca-48f0-a4b6-c0f1bead5201"
  ],
  "cascade_stalled": false,
  "value_delivered": 6,
  "personasExecuted": 6,
  "memberCount": 6,
  "eventsDelivered": 17,
  "reviews": 1,
  "pendingReviews": 1,
  "learnedMemories": 6,
  "cost_usd": 7.482742249999999,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
