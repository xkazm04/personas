# Build-bench report — web-research-desk

> 3 web-research capabilities + 2 connector tool-reactions (Airtable, Notion). Exercises fan-out #1 (5 independent capability resolutions) and fan-out #2 (2 real connector tool-tests). The web-research caps are native (no credential); the two reactions bind to healthy Airtable + Notion vault credentials.

## Side-by-side

| Metric | multiagent |
|---|---|
| runs | 2 |
| promote rate | 0% |
| total time (median s) | 649.46 |
| total time (min–max s) | 624.72–674.2 |
| capabilities (median) | 5.0 |
| gate pass rate (median) | 100% |
| cost USD (median) | 0.55 |

## Per-phase median seconds (coarse, from polling)

| Phase | multiagent |
|---|---|
| analyzing | 40.54 |
| resolving | 213.97 |
| testing | 50.3 |
| failed | 0.0 |

_Precise per-event timing + cost land with Phase 0 telemetry (`phase_timings_json` / `total_cost_usd` on build_sessions)._