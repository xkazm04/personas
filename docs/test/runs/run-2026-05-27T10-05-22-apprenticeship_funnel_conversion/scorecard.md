# Scorecard (judged) — run-2026-05-27T10-05-22-apprenticeship_funnel_conversion

**Team:** SDLC — Apprenticeship Placement · **Seed:** apprenticeship/funnel-conversion · **Verdict:** `PRODUCTION` · **team score:** 97

> Judged scorecard (deterministic + agent-judge §1.B + portfolio balance §2.1). Still requires 3 consecutive PRODUCTION on held-out seeds + decay analysis to CERTIFY.

## Deterministic dimensions
| Dim | Score | Basis |
|---|---|---|
| Cascade completion | 100 | 5/5 members executed |
| Work density | 100 | 5/5 executions completed (no retries/noops) |
| Handoff health | 100 | 14/14 events delivered |
| Learning loop | 100 | 3 reviews + 5 learned memories |
| **Grounding gate** | 100 | cited file paths that actually exist, across 2 doc artifacts |

## Judge dimensions (agent-judge §1.B + §2.1)
- **Per-persona output grades:** [95,92,90,92,84] (min 84)
- **Portfolio balance:** 88 — Excellent single-cascade balance: feature + unprompted test-infra (architect) + independent review + security audit (CVE + PII) + responsible gated release + docs-currency check. The team self-balanced toward quality and stability without being told — wrote the repo's first tests, caught a latent UI bug, surfaced a real PII concern, and refused to over-scope the release commit.
- **Work taxonomy:** {"feature":1,"test":1,"review":1,"security":1,"release-ops":1,"docs":1}
  - **architect** (feature,test): {"correctness":95,"actionability":95,"specificity":94,"role_fidelity":96} — _"Built pure typed computeFunnelConversion() with a single safePct() choke-point: zero/negative denominator→0, non-finite→"_
  - **reviewer** (review): {"correctness":90,"actionability":90,"specificity":92,"role_fidelity":95} — _"Did NOT trust the handoff — independently re-ran tsc (exit 0), npm test (6/6), eslint (exit 0) and confirmed every claim"_
  - **security** (security): {"correctness":88,"actionability":88,"specificity":90,"role_fidelity":92} — _"Ran npm audit (2 moderate), found transitive postcss XSS CVE with concrete override fix; ranked Medium with honest reach"_
  - **release** (release-ops): {"correctness":92,"actionability":90,"specificity":90,"role_fidelity":95} — _"Detected a half-completed release (CHANGELOG had [0.2.0] but package.json still 0.1.0, no tag) and finished it correctly"_
  - **docs** (docs): {"correctness":86,"actionability":78,"specificity":84,"role_fidelity":88} — _"Correctly diffed 2fee916..331e9d7, classified it documentation-only, confirmed README+CHANGELOG already carry v0.2.0, an"_
- **Judge notes:** BASELINE (default model + medium effort everywhere). Genuinely production-grade across all 5 roles — no rubber-stamping, real independent verification, real defect-finding, self-critical ADR, disciplined release scoping. Only soft spot: docs received a thin handoff payload (no_input_available) and shipped no delta, though its no-op was correct. Per-role cost: architect $1.02/283s, reviewer $0.54/192s, security $0.51/190s, release $0.60/206s, docs $0.51/94s; total $3.18/964s. This is the quality bar the 'tuned' composition must MATCH at lower cost to be worth adopting.

## Grounding detail (the anti-eloquence gate)
- `docs/adr/0001-funnel-conversion-rate.md` — 4/4 cited paths exist (100%)
- `docs/releases/v0.2.0.md` — 1/1 cited paths exist (100%)

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
  "eventsDelivered": 14,
  "reviews": 3,
  "pendingReviews": 3,
  "learnedMemories": 5,
  "cost_usd": 3.18061975,
  "repoChanged": true
}
```

## To CERTIFY (not yet)
- Needs **3 consecutive PRODUCTION** runs on **held-out** seeds + decay analysis (§3). One judged run is necessary, not sufficient.
