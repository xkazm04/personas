# Build-bench report — lite-web-summary

> Lean baseline fixture: 3 native web-research capabilities, NO external connectors. Chosen to complete headless in ~3-5 min so it gives a clean, repeatable baseline (the heavier web-research-desk fixture stalls on connector questions + is too slow for a bounded one-shot run). Use this for baseline + as-is/to-be A/B; use web-research-desk as a fan-out stress fixture.

## Side-by-side

| Metric | multiagent |
|---|---|
| runs | 1 |
| promote rate | 0% |
| total time (median s) | 48.05 |
| total time (min–max s) | 48.05–48.05 |
| capabilities (median) | 0.0 |
| gate pass rate (median) | 33% |
| cost USD (median) | 0.42 |

## Per-phase median seconds (coarse, from polling)

| Phase | multiagent |
|---|---|
| analyzing | 25.53 |
| resolving | 22.52 |
| failed | 0.0 |

_Precise per-event timing + cost land with Phase 0 telemetry (`phase_timings_json` / `total_cost_usd` on build_sessions)._