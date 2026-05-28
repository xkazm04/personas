# Scorecard (deterministic, provisional) — run-2026-05-28T23-12-43-sdlc2_ai_bookkeeper_cert_5

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-cert-5 · **Provisional verdict:** `PRODUCTION` · **team score:** 98

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 6/6 members executed |
| Work density | 100 | 6/6 executions completed (no retries/noops) |
| Handoff health | 89 | 16/18 events delivered |
| Learning loop | 100 | 1 reviews + 6 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 3 doc artifacts |
| **Code-track §1.A** | ok | build=pass · lint=pass · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `CHANGELOG.md` — 6/6 cited paths exist (100%)
- `docs/releases/v0.7.0.md` — 3/3 cited paths exist (100%)
- `README.md` — 32/32 cited paths exist (100%)

## Facts
```json
{
  "executions": 6,
  "completed": 6,
  "failed": 0,
  "failed_not_rescued": 0,
  "rescued_failures": [],
  "cascade_stalled": false,
  "value_delivered": 6,
  "personasExecuted": 6,
  "memberCount": 6,
  "eventsDelivered": 16,
  "reviews": 1,
  "pendingReviews": 1,
  "learnedMemories": 6,
  "cost_usd": 5.072440500000001,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
