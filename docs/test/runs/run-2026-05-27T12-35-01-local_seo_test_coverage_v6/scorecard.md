# Scorecard (deterministic, provisional) — run-2026-05-27T12-35-01-local_seo_test_coverage_v6

**Team:** SDLC Delivery Team · **Seed:** local-seo/test-coverage-v6 · **Provisional verdict:** `PRODUCTION` · **team score:** 96

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 120 | 6/5 members executed |
| Work density | 100 | 6/6 executions completed (no retries/noops) |
| Handoff health | 100 | 17/17 events delivered |
| Learning loop | 100 | 5 reviews + 6 learned memories |
| **Grounding gate** | n/a | cited file paths that actually exist, across 0 doc artifacts |

## Grounding detail (the anti-eloquence gate)

## Facts
```json
{
  "executions": 6,
  "completed": 6,
  "failed": 0,
  "cascade_stalled": false,
  "value_delivered": 6,
  "personasExecuted": 6,
  "memberCount": 5,
  "eventsDelivered": 17,
  "reviews": 5,
  "pendingReviews": 5,
  "learnedMemories": 6,
  "cost_usd": 3.72983275,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
