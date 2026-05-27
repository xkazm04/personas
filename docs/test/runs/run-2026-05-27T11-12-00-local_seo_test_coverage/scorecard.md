# Scorecard (deterministic, provisional) — run-2026-05-27T11-12-00-local_seo_test_coverage

**Team:** SDLC — Local SEO Agency · **Seed:** local-seo/test-coverage · **Provisional verdict:** `NOT-READY` · **team score:** 97

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 5/5 members executed |
| Work density | 100 | 5/5 executions completed (no retries/noops) |
| Handoff health | 100 | 13/13 events delivered |
| Learning loop | 100 | 4 reviews + 5 learned memories |
| **Grounding gate** | 85 | cited file paths that actually exist, across 4 doc artifacts |
| **Code-track §1.A** | FAIL | build=pass · lint=pass · test=fail (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `README.md` — 7/7 cited paths exist (100%)
- `CHANGELOG.md` — 0/0 cited paths exist (n/a%)
- `docs/adr/ADR-0001-test-harness-and-pure-logic-coverage.md` — 7/9 cited paths exist (78%) · unresolved: src/features/rankings/rank.ts, rankings/rank.ts
- `docs/backlog-brainstorm.md` — 0/0 cited paths exist (n/a%)
- `docs/harness/moonshots-2026-05-21/INDEX.md` — 11/18 cited paths exist (61%) · unresolved: src/features/rankings/components/RevenueRoadmap.tsx, src/features/rankings/components/CounterMoves.tsx, src/features/rankings/components/ResolutionCall.tsx, src/features/rankings/components/ProximityHeatmap.tsx, src/features/rankings/components/StrategyReview.tsx, src/lib/prompts/registry/agents/moonshot-architect.ts, .ts/.tsx
- `docs/harness/moonshots-2026-05-21/moonshots.md` — 12/12 cited paths exist (100%)

## Facts
```json
{
  "executions": 5,
  "completed": 5,
  "failed": 0,
  "cascade_stalled": false,
  "value_delivered": 4,
  "personasExecuted": 5,
  "memberCount": 5,
  "eventsDelivered": 13,
  "reviews": 4,
  "pendingReviews": 4,
  "learnedMemories": 5,
  "cost_usd": 2.6034740000000003,
  "repoChanged": true
}
```

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
