# Scorecard (deterministic, provisional) — run-2026-06-02T07-49-13-sdlc2_immigration_stabilization

**Team:** SDLC2 — Immigration · **Seed:** sdlc2/immigration-stabilization · **Provisional verdict:** `NOT-READY` · **team score:** 100

> FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 8/8 members executed |
| Work density | 100 | 8/8 executions completed (no retries/noops) |
| Handoff health | 100 | 24/24 events delivered |
| Learning loop | 100 | 1 reviews + 6 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 1 doc artifacts |
| **Code-track §1.A** | FAIL | build=fail · lint=fail · test=fail (repo's own commands on post-run state) |

## Grounding detail (the anti-eloquence gate)
- `docs/adr/0003-format-helpers-non-finite-guard.md` — 7/7 cited paths exist (100%)

## Facts
```json
{
  "executions": 8,
  "completed": 8,
  "failed": 0,
  "failed_not_rescued": 0,
  "rescued_failures": [],
  "cascade_stalled": false,
  "value_delivered": 7,
  "personasExecuted": 8,
  "memberCount": 8,
  "eventsDelivered": 24,
  "reviews": 1,
  "pendingReviews": 1,
  "learnedMemories": 6,
  "cost_usd": 7.00114275,
  "repoChanged": true
}
```

## Standards & branching compliance (§7)
> Bound project's declared policy (Dev Tools → Standards stage). Compliance: **50%**.

| Rule | Status | Basis |
|---|---|---|
| `precommit.lint` | ❌ fail | policy requires lint to pass · code-track lint=fail |
| `precommit.code_quality` | ❌ fail | policy requires code quality · build=fail test=fail |
| `precommit.docs_required` | ✅ pass | docs changed in the increment |
| `branching.pr_base` | ✅ pass | increment reached the main base |
| `branching.automerge` | — n/a | policy enables GitHub auto-merge into main (not locally observable) |

## Not yet scored (needs agent-judge, §1.B + §2.1)
- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.
- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.
