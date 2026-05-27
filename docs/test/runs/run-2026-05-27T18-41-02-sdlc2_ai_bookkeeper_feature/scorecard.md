# Scorecard (deterministic, provisional) — run-2026-05-27T18-41-02-sdlc2_ai_bookkeeper_feature

**Team:** SDLC2 — ai-bookkeeper · **Seed:** sdlc2/ai-bookkeeper-feature · **Provisional verdict:** `PRODUCTION` · **team score:** 100

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 6/6 members executed |
| Work density | 100 | 6/6 executions completed (no retries/noops) |
| Handoff health | 100 | 18/18 events delivered |
| Learning loop | 100 | 4 reviews + 6 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 6 doc artifacts |
| **Code-track §1.A** | ok | build=pass · lint=pass · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `docs/adr/0002-currency-aware-banker-rounding.md` — 10/10 cited paths exist (100%)
- `README.md` — 7/7 cited paths exist (100%)
- `CHANGELOG.md` — 2/2 cited paths exist (100%)
- `docs/adr/0001-monetary-amount-input-validation.md` — 16/16 cited paths exist (100%)
- `docs/backlog-brainstorm.md` — 0/0 cited paths exist (n/a%)
- `docs/releases/v0.2.0.md` — 3/3 cited paths exist (100%)
- `docs/releases/v0.3.0.md` — 6/6 cited paths exist (100%)

## Facts
```json
{
  "executions": 6,
  "completed": 6,
  "failed": 0,
  "cascade_stalled": false,
  "value_delivered": 6,
  "personasExecuted": 6,
  "memberCount": 6,
  "eventsDelivered": 18,
  "reviews": 4,
  "pendingReviews": 4,
  "learnedMemories": 6,
  "cost_usd": 4.22484875,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
