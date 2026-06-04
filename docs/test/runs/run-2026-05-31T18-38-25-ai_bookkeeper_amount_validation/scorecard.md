# Scorecard (deterministic, provisional) — run-2026-05-31T18-38-25-ai_bookkeeper_amount_validation

**Team:** SDLC — ai-bookkeeper · **Seed:** ai-bookkeeper/amount-validation · **Provisional verdict:** `NOT-READY` · **team score:** 90

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 50 | 4/8 members executed |
| Work density | 100 | 7/7 executions completed (no retries/noops) |
| Handoff health | 100 | 21/21 events delivered |
| Learning loop | 100 | 6 reviews + 6 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 3 doc artifacts |
| **Code-track §1.A** | FAIL | build=pass · lint=fail · test=pass (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `CHANGELOG.md` — 16/16 cited paths exist (100%)
- `README.md` — 60/60 cited paths exist (100%)
- `docs/adr/0008-wire-amount-validation-into-categorize-route.md` — 6/6 cited paths exist (100%)

## Facts
```json
{
  "executions": 7,
  "completed": 7,
  "failed": 0,
  "failed_not_rescued": 0,
  "rescued_failures": [],
  "cascade_stalled": true,
  "value_delivered": 7,
  "personasExecuted": 4,
  "memberCount": 8,
  "eventsDelivered": 21,
  "reviews": 6,
  "pendingReviews": 6,
  "learnedMemories": 6,
  "cost_usd": 8.112976750000001,
  "repoChanged": true
}
```

## Standards & branching compliance (§7)
> Bound project's declared policy (Dev Tools → Standards stage). Compliance: **75%**.

| Rule | Status | Basis |
|---|---|---|
| `precommit.lint` | ❌ fail | policy requires lint to pass · code-track lint=fail |
| `precommit.code_quality` | ✅ pass | policy requires code quality · build=pass test=pass |
| `precommit.docs_required` | ✅ pass | docs changed in the increment |
| `branching.pr_base` | ✅ pass | increment reached the main base |

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
