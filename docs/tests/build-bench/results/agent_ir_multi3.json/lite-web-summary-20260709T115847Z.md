# Build-bench report — lite-web-summary

> Lean baseline fixture: 3 native web-research capabilities, NO external connectors. Chosen to complete headless in ~3-5 min so it gives a clean, repeatable baseline (the heavier web-research-desk fixture stalls on connector questions + is too slow for a bounded one-shot run). Use this for baseline + as-is/to-be A/B; use web-research-desk as a fan-out stress fixture.

## Side-by-side

| Metric | multiagent |
|---|---|
| runs | 3 |
| promote rate | 100% |
| total time (median s) | 63.06 |
| total time (min–max s) | 63.06–70.59 |
| capabilities (median) | 3.0 |
| gate pass rate (median) | 100% |
| cost USD (median) | 0.3 |

## Per-phase median seconds (coarse, from polling)

| Phase | multiagent |
|---|---|
| analyzing | 24.03 |
| resolving | 25.53 |
| testing | 13.51 |
| promoted | 0.0 |

_Precise per-event timing + cost land with Phase 0 telemetry (`phase_timings_json` / `total_cost_usd` on build_sessions)._