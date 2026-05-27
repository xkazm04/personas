# Scorecard (judged) — run-2026-05-27T08-46-34-grant_writing_test_coverage

**Team:** SDLC — Grant Writing Nonprofits · **Seed:** grant-writing/test-coverage · **Verdict:** `PRODUCTION` · **team score:** 91

> Judged scorecard (deterministic + agent-judge §1.B + portfolio balance §2.1). Still requires 3 consecutive PRODUCTION on held-out seeds + decay analysis to CERTIFY.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 5/5 members executed |
| Work density | 100 | 5/5 executions completed (no retries/noops) |
| Handoff health | 100 | 15/15 events delivered |
| Learning loop | 100 | 4 reviews + 5 learned memories |
| **Grounding gate** | 79 | cited file paths that actually exist, across 4 doc artifacts |

## Judge dimensions (agent-judge §1.B + §2.1)
- **Per-persona output grades:** [79,79,79,79,71] (min 71)
- **Portfolio balance:** 82 — Strong balance on a test-coverage seed: the team added real tests for the riskiest path + reviewed + audited + released. CAVEAT: §1.A caught an INTERMITTENT test failure (storage.test.ts — a zero-fit grant leaking into the needs-enrichment list, likely an order-dependent in-memory-DB pollution and/or a side-effect of the toNum→null fix). It passed on retry this run, but the flakiness is a real quality concern — the team's test work may have introduced or exposed order-dependence. Investigate before certification.
- **Work taxonomy:** {"test":1,"stabilization":1,"design":1,"review":1,"security":1,"release/ops":1,"docs":1}
  - **Solution Architect** (test,stabilization,design): {"correctness":84,"actionability":84,"specificity":82,"role_fidelity":86} — _"Completed this time (15-min timeout). On a test-coverage seed it added real tests (grantsGov.test.ts, getMatches.test.ts"_
  - **Code Reviewer** (review): {"correctness":80,"actionability":80,"specificity":80,"role_fidelity":82} — _"completed value_delivered"_
  - **Security Sentinel** (security): {"correctness":80,"actionability":80,"specificity":80,"role_fidelity":82} — _"completed value_delivered"_
  - **Release Manager** (release/ops,docs): {"correctness":80,"actionability":80,"specificity":80,"role_fidelity":84} — _"completed value_delivered; CHANGELOG + 0.2.0 release"_
  - **Docs Steward** (docs): {"correctness":70,"actionability":70,"specificity":70,"role_fidelity":75} — _"no_input_available — honest no-op (docs already current)"_
- **Judge notes:** Timeout fix VERIFIED: cascade 5/5 (was 1/5 killed at 5 min). Build+lint+test green this run. Verdict PRODUCTION-quality but watch the intermittent storage.test.ts failure (§1.A flaky-retry now flags this class). Not certified (1 run, non-held-out, + the flakiness).

## Grounding detail (the anti-eloquence gate)
- `README.md` — 3/3 cited paths exist (100%)
- `CHANGELOG.md` — 0/0 cited paths exist (n/a%)
- `docs/adr/ADR-0001-test-the-grants-gov-normalization-boundary.md` — 1/2 cited paths exist (50%) · unresolved: grant-ingest/storage.ts
- `docs/adr/ADR-0002-ai-input-trust-boundary-at-prompt-assembly.md` — 2/3 cited paths exist (67%) · unresolved: /actions.ts
- `docs/adr/ADR-0003-test-the-getmatches-assembly-boundary.md` — 1/1 cited paths exist (100%)

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
  "eventsDelivered": 15,
  "reviews": 4,
  "pendingReviews": 4,
  "learnedMemories": 5,
  "cost_usd": 4.195344,
  "repoChanged": true
}
```

## To CERTIFY (not yet)
- Needs **3 consecutive PRODUCTION** runs on **held-out** seeds + decay analysis (§3). One judged run is necessary, not sufficient.
