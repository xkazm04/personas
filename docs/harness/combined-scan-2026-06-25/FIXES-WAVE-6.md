# Combined-Scan Fix Wave 6 — Wrong metric / unit / threshold math

> 6 atomic fix-commits, 6 findings closed (all High) — no deferrals.
> Dispatched as 6 parallel edit-only fix-subagents (4 Rust + 2 FE, disjoint files).
> Baseline preserved: **Rust recipe 113/0, kpi_eval 7/0, connector_strategy 5/0 + compile; tsc 0; vitest 1976/7 (+4 new, no regressions)**.

## Commits

| # | Commit | Finding | Stack |
|---|---|---|---|
| 1 | `aa9c65d1c` | dashboard #1 (ratio-vs-% dead card) | FE |
| 2 | `8b7261611` | analytics-sla #1 (0%-no-data) | FE |
| 3 | `78ad20b06` | connector-catalog #1 (google substring mis-route) | Rust |
| 4 | `98e16e634` | director #1 (json_path partial match) | Rust |
| 5 | `f2257b7f8` | build-sessions #5 (intent-compiler /1K vs /1M) | Rust |
| 6 | `253a4430e` | recipes #2 (eligibility false-green) | Rust |

## What was fixed

1. **Dashboard "Fleet Running Smoothly" dead card.** `overall_success_rate` is a [0,1] ratio but compared against `80`, so the healthy branch always returned null and the reassuring card could never render. Normalized once to a percentage, used in both the gate and the description; +4-case test.
2. **SLA red 0% on empty window.** A fresh/quiet window rendered the global cards as red "0.0%" ("everything is failing") when the truth was "no data". Now detects `successful + failed === 0` (already on the binding) and shows a neutral "no activity" card; a genuine 0%-with-failures still shows red.
3. **Connector google mis-route.** The `contains("google")` strategy substring routed the api-key `google_gemini` connector to GoogleOAuthStrategy → "missing refresh_token" broke its healthcheck (false NeedsSetup) and every live call. Gated the substring on `oauth_type == "google"`; gemini now uses DefaultStrategy + its api_key.
4. **Director json_path partial match.** A `json_path:total.pct` over `{"total":100}` recorded **100** (the intermediate node) instead of failing. Now only a fully-walked path resolves; a partial path yields `None`. +test.
5. **Intent-compiler 1000× cost label.** The model price anchors were labeled `/1K tokens` but the magnitudes are real per-million figures — a 1000× unit error corrupting the cost estimate and model pick. Corrected the label to `per 1M tokens` (magnitudes unchanged).
6. **Recipe-eligibility false green.** A recipe with no tool signal but real `connectors[]` requirements scored `Eligible` (one-click adopt → persona fails on first run). Now scores the existing `AdoptableWithSetup` state; adoption refuses to auto-wire the connector-only case. Real-tool-overlap recipes still `Eligible`. +5 tests. (Catalog UI already scores connectors via a separate resolver — no UI churn; full connector-vs-credential scoring in the Rust gate deferred.)

## Verification

| Gate | Result |
|---|---|
| Rust (recipe / kpi_eval / connector_strategy) | 113/0 · 7/0 · 5/0 + compile |
| `tsc --noEmit` | 0 |
| `vitest run` | 1976 pass / 7 pre-existing fail (+4 new tests, no regressions) |
| eslint (pre-commit) | clean |

## Patterns established (catalogue items 18–20)

18. **Ratio compared against a percentage** — a [0,1] value gated against an 80-style threshold silently dead-ends a branch (or prints "1%"). Normalize once at the boundary and pin the convention with a test.
19. **No-data conflated with zero** — `0` from "nothing happened" rendered the same as `0%` "everything failed" is a misleading metric. Detect the empty sample (count == 0) and render a distinct neutral state; reserve the alarming state for a real zero.
20. **Permissive default on an unverifiable requirement** — "Eligible because I found no requirements I could parse" promises readiness it didn't verify. Downgrade no-signal cases to an explicit "needs setup" state instead of the confident-green default.

## Cumulative status (Waves 1–6)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1 | Security | 5 (2C/2H/1M) |
| 2 | Auth / trust-boundary | 6 (2C mitigated / 4H) |
| 3 | Scheduler / watermark / sync | 4 (1C/3H) + 1H deferred |
| 4 | Races & double-execution | 6 (1C/5H) |
| 5 | Silent failures & success-theater | 6 (6H) |
| 6 | Wrong metric / unit / threshold | 6 (6H) |

**Total: 33 findings addressed across ~45 commits, 0 regressions.**
**Remaining:** ~55 High + Med/Low tail. Next: Wave 7 — Execution / lifecycle reliability (execution persona-switch drops terminal event, cancel abandons run on backend-fail, dead-letter persists empty Failed, lab shared matrixLifecycle clobber, activateVersion non-atomic).
