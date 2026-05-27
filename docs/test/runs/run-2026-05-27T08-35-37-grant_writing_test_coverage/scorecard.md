# Scorecard (judged) — run-2026-05-27T08-35-37-grant_writing_test_coverage

**Team:** SDLC — Grant Writing Nonprofits · **Seed:** grant-writing/test-coverage · **Verdict:** `BROKEN` · **team score:** 14

> Judged scorecard (deterministic + agent-judge §1.B + portfolio balance §2.1). Still requires 3 consecutive PRODUCTION on held-out seeds + decay analysis to CERTIFY.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 20 | 1/5 members executed |
| Work density | 0 | 0/1 executions completed (no retries/noops) |
| Handoff health | 0 | 0/0 events delivered |
| Learning loop | 0 | 0 reviews + 0 learned memories |
| **Grounding gate** | 75 | cited file paths that actually exist, across 2 doc artifacts |

## Judge dimensions (agent-judge §1.B + §2.1)
- **Per-persona output grades:** [0] (min 0)
- **Portfolio balance:** 0 — Unmeasurable at the run level (BROKEN — timeout). But the architect's killed-in-progress work was the strongest balance signal yet: on a test-coverage seed it wrote real tests AND fixed two real data bugs AND verified the whole suite. The blocker is the 5-min execution timeout (now bumped to 15 min), not the team.
- **Work taxonomy:** {"test":1,"stabilization":1,"design":1}
  - **Solution Architect** (test,stabilization,design): {"correctness":0,"actionability":0,"specificity":0,"role_fidelity":0} — _"Execution TIMED OUT at 300s mid-task and was killed (status=failed) — scored 0 at the RUN level because a killed executi"_
- **Judge notes:** BROKEN — execution timeout (300s) killed a highly productive coding turn mid-task. Root cause + fix (timeout 300s->900s on all 35 team personas) in FINDINGS run-4. Re-run grant-writing/test-coverage to get a real verdict; expect the architect to finish and the cascade to proceed.

## Grounding detail (the anti-eloquence gate)
- `README.md` — 3/3 cited paths exist (100%)
- `CHANGELOG.md` — 0/0 cited paths exist (n/a%)
- `docs/adr/ADR-0001-test-the-grants-gov-normalization-boundary.md` — 1/2 cited paths exist (50%) · unresolved: grant-ingest/storage.ts

## Facts
```json
{
  "executions": 1,
  "completed": 0,
  "failed": 1,
  "cascade_stalled": true,
  "value_delivered": 0,
  "personasExecuted": 1,
  "memberCount": 5,
  "eventsDelivered": 0,
  "reviews": 0,
  "pendingReviews": 0,
  "learnedMemories": 0,
  "cost_usd": 0,
  "repoChanged": true
}
```

## To CERTIFY (not yet)
- Needs **3 consecutive PRODUCTION** runs on **held-out** seeds + decay analysis (§3). One judged run is necessary, not sufficient.
