# Scorecard (deterministic, provisional) — run-2026-05-28T18-24-41-sdlc2_ai_bookkeeper_cert_1

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-1 · **Provisional verdict:** `NOT-READY` · **team score:** 97

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 6/6 members executed |
| Work density | 83 | 5/6 executions completed (no retries/noops) |
| Handoff health | 100 | 16/16 events delivered |
| Learning loop | 100 | 3 reviews + 5 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 3 doc artifacts |
| **Code-track §1.A** | FAIL | build=pass · lint=fail · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `CHANGELOG.md` — 2/2 cited paths exist (100%)
- `docs/adr/0003-money-arithmetic-module.md` — 10/10 cited paths exist (100%)
- `docs/releases/v0.4.0.md` — 5/5 cited paths exist (100%)

## Facts
```json
{
  "executions": 6,
  "completed": 5,
  "failed": 1,
  "cascade_stalled": true,
  "value_delivered": 5,
  "personasExecuted": 6,
  "memberCount": 6,
  "eventsDelivered": 16,
  "reviews": 3,
  "pendingReviews": 3,
  "learnedMemories": 5,
  "cost_usd": 5.115302750000001,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
