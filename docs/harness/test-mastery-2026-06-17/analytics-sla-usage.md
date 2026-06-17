# Test Mastery — Analytics, SLA & Usage
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. Token/cost projection engine (`cost.rs`) has zero tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/cost.rs:11-142
- **Current test state**: none
- **Scenario**: `cost.rs` is the money math behind every pre-flight execution preview and budget gate: `estimate_tokens`, `input/output_cost_per_million` (per-model price table), `estimate_input_cost`, `estimate_output_cost`, and `build_preview` (which fixes the 0.4 output-token ratio and the $-per-million arithmetic). A regression here — a misplaced decimal in a price tier, the `/ 1_000_000.0` divisor dropped, the default-pricing fall-through changed, or the model-substring matcher reordered so "gpt-4o" is caught by the "gpt-4" branch — silently produces wrong cost previews. Budget checks and user-facing "this run costs $X" both consume this. The whole file has NO `#[cfg(test)]` module, while sibling engine files (`ai_healing.rs`, `auto_triage.rs`, etc.) all carry `mod tests`.
- **Root cause**: Treated as "pure helpers / approximate anyway" so it was never gated; the approximation excuse hides that the *arithmetic structure and price ordering* are exact contracts, not approximations.
- **Impact**: Wrong cost estimates mislead users on spend, can let a run that should be blocked slip past a budget preview (under-estimate) or scare users off a cheap run (over-estimate) — directly erodes trust in the metering surface and can cause real overspend.
- **Fix sketch**: LLM-generatable Rust `#[cfg(test)]` batch. Assert *business invariants*, not snapshots: (a) `estimate_input_cost(1_000_000, "opus") == 15.0` and one anchor per tier; (b) ordering trap — `input_cost_per_million("gpt-4o") == 2.5` (NOT 30.0), proving the `gpt-4o` branch precedes `gpt-4`; (c) unknown model falls back to Sonnet pricing (3.0 in / 15.0 out); (d) `build_preview` total == input+output and output_tokens == ceil(input*0.4); (e) `estimate_tokens` is monotonic and ceil-rounds; (f) case-insensitivity ("OPUS" == "opus").

## 2. SLA day-window guard (`get_sla_dashboard` command) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/communication/sla.rs:14-21
- **Current test state**: none (repo layer is well-tested; this command guard is not)
- **Scenario**: The command does `days.unwrap_or(30).clamp(1, 365)`. This single line is the only thing protecting the SLA SQL from a `days=0` (→ `datetime('now','-0 days')`, an empty/degenerate window) or a hostile/huge value (`days=100000` → full-table scan across every persona, the exact quadratic blow-up the `CONSECUTIVE_FAILURE_LOOKBACK` comment warns about). If a refactor drops the clamp or flips the default, no test fails.
- **Root cause**: Thin command wrappers are assumed "too trivial to test", but the default + clamp *are* the policy and they have no other enforcement point.
- **Impact**: A regressed default silently changes every dashboard number for all users (30d→something else); a dropped upper clamp turns the SLA tab into a DB-pegging query at fleet scale.
- **Fix sketch**: Rust test exercising the boundary via the repo (the clamp logic can be extracted to a tiny pure fn `clamp_days(Option<i64>) -> i64` and unit-tested directly): assert `None → 30`, `Some(0) → 1`, `Some(-5) → 1`, `Some(99999) → 365`, `Some(30) → 30`. Invariant: result is always in `[1,365]`.

## 3. Leaderboard scoring engine (`leaderboardScoring.ts`) — pure ranking math, no tests
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts:70-179
- **Current test state**: none (no `.test.ts` anywhere under sub_leaderboard)
- **Scenario**: `computeLeaderboard` is the persona ranking shown to users as authoritative ("who's your best agent"). It blends 5 weighted dimensions (weights must sum to 1.0), normalizes speed/cost relative to fleet average, clamps to 0–100, and sorts with a documented tiebreak (composite, then successRate) plus medal/tier assignment. All pure, all deterministic, all untestable-by-eye. A regression in the speed/cost ratio formula (`100*(1-(ratio-0.5)/1.5)`), a weight typo, an inverted "lower-is-better" sign on cost, or a broken tiebreak would silently reorder the board.
- **Root cause**: Pure lib was never gated; ranking bugs are invisible without seeded fixtures because the output "looks plausible".
- **Impact**: Mis-ranking sends users to "improve" the wrong agent and undermines the leaderboard's credibility — a core analytics surface.
- **Fix sketch**: LLM-generatable vitest batch over `PersonaHealthSignal[]` fixtures. Invariants (not snapshots): weights sum to exactly 1.0; `scoreSpeed(0.5*avg) == 100`, `(avg) == 50`, `(2*avg) == 0`, clamped at bounds; cost scoring lower-is-better (cheaper agent scores higher); empty input → `[]`; ranks are `1..n` contiguous, medals only on ranks 1/2/3; composite ties broken by successRate; `assignTier` boundaries (80/60/40). Add `rankBy`/`biggestOpportunity` from `leaderboardRanking.ts` to the same batch: `rankBy(x,'overall')` returns input untouched; `biggestOpportunity` picks the largest `weight*(100-value)` gap and returns null when maxed.

## 4. `ExecutionHeatmap.buildGrid` — time-dependent date grid, untested + non-deterministic
- **Severity**: high
- **Category**: flaky-nondeterministic
- **File**: src/features/overview/sub_analytics/components/ExecutionHeatmap.tsx:73-165
- **Current test state**: none
- **Scenario**: `buildGrid` densifies a sparse server response into a 53-week × 7-day calendar anchored on *today*, padding to Sunday/Saturday week boundaries and placing month labels. It reads `new Date()` directly, so behavior shifts by weekday, by DST transitions, and across year boundaries. Off-by-one bugs in the Sunday-pad / Saturday-pad arithmetic, or `intensityFor` threshold bucketing, would mis-place activity cells (e.g. show a busy day as empty) and only manifest on certain calendar dates — a latent flaky surface.
- **Root cause**: Logic embedded in a component with a live clock and no injected "today", so it's both untested and unpinnable; intensity bucketing (`intensityFor`) is a pure fn buried in the same file.
- **Impact**: Heatmap silently misrepresents execution activity on certain dates; a date-math regression ships unnoticed until a user is on the wrong weekday.
- **Fix sketch**: Extract `buildGrid` (+ `intensityFor`, `formatIso`) into a pure lib taking `today` as a parameter; vitest with `vi.setSystemTime` / injected date. Invariants: total cells is a multiple of 7; first column starts on Sunday, last on Saturday; the rightmost real cell == injected today; a server day maps to exactly one grid cell with matching count/cost; future cells flagged `isFuture`; `intensityFor` returns 0 only for count≤0 and respects the 4 thresholds at boundaries.

## 5. `ChartTooltip` default value formatter — unit mapping untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/overview/sub_usage/charts/ChartTooltip.tsx:12-28 (+ chartConstants.ts:48-65 `metricUnitForKey`)
- **Current test state**: none
- **Scenario**: `defaultFormatter` turns raw chart values into the strings users read in every usage tooltip: USD currency, `ms`, `tokens`, `%`, or grouped count, with a `--` guard for non-finite values. `metricUnitForKey` maps a Recharts `dataKey` to its unit. A wrong-unit mapping (cost rendered as a bare count, latency rendered as tokens) or a dropped `Number.isFinite` guard (NaN/Infinity rendered literally) is pure-function-checkable and currently unguarded.
- **Root cause**: Presentation formatter assumed trivial; the unit-key table is data that drifts as new metrics are added.
- **Impact**: Misleading cost/usage tooltips — a user reading "$1,234" as "1234 tokens" misjudges spend. Low blast radius (display only) but on the money-facing usage tab.
- **Fix sketch**: LLM-generatable vitest batch. Invariants: `metricUnitForKey('cost')==='usd'`, `'p95'==='ms'`, `'tokens'==='tokens'`, unknown key → `'count'`; `defaultFormatter(NaN, *)==='--'` and `(Infinity,*)==='--'`; usd formatting includes the currency symbol and ≤2 fraction digits; ms/tokens/percent suffixes present. Use locale-agnostic assertions (assert on suffix/structure, not on a hard-coded thousands separator, to avoid CI-locale flakiness).

## 6. `RotationOverviewPanel` countdown/summary — pure time logic untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:59-83 (`countdownParts`, `summaryStats`) + `rotationBadge` 16-50
- **Current test state**: none
- **Scenario**: `countdownParts` decides "is this credential rotation due NOW" (`diff <= 0 → isDue`) and the days/hours remaining; `summaryStats` counts active/expiring-soon (<7d)/anomalies. These drive the red "due now" accent and the expiring-soon pill on the security-adjacent rotation panel. A sign flip or a wrong 7-day window means an overdue credential reads as healthy. Time-dependent (`Date.now()`), so also a latent determinism risk.
- **Root cause**: Helpers live inside the component with a live clock; never extracted or gated.
- **Impact**: A rotation that's overdue (or expiring in days) is shown as fine — a credential-hygiene signal silently lost.
- **Fix sketch**: Extract the three helpers to a lib; vitest with frozen `Date.now`. Invariants: `countdownParts(null)===null`; past timestamp → `{isDue:true}`; a timestamp 25h out → `{days:1, hours:1}`; `summaryStats` counts only `has_policy && policy_enabled` as active, `expiringSoon` strictly inside `(0, 7d)`, anomalies independent of policy state. `rotationBadge` remediation precedence (Disable > RotateThenAlert > PreemptiveRotation > BackoffRetry > fresh/active) is an enum→label mapping worth a small table-driven test.

## 7. SLA `percentile` helper has no direct test
- **Severity**: low
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/sla.rs:439-447
- **Current test state**: adequate-nearby (sibling fns `compute_mtbf`, `parse_execution_timestamp`, success-rate, streak-cap are all well-tested) but `percentile` itself is only covered transitively via integration, with no assertion pinning p95 to a known input.
- **Scenario**: `percentile` computes p95 latency on the SLA card. The nearest-rank index math (`round(p/100*(len-1))`) and the empty-slice → 0.0 guard are exact contracts. The surrounding repo tests never assert a specific p95 value, so an off-by-one in the index or a change to the rounding rule would pass CI.
- **Root cause**: Overshadowed by the strong tests on its siblings; the one pure fn in the file without its own unit test.
- **Impact**: p95 latency (a headline reliability number) could quietly compute the wrong order statistic; low severity because it's a display metric, not a gate.
- **Fix sketch**: Add to the existing `mod tests` in sla.rs: `percentile(&[], 95.0)==0.0`; single element returns itself; `percentile(&[1..=100 as f64], 95.0)` returns the documented nearest-rank value; assert index never exceeds `len-1`. Tiny, deterministic, fits the file's existing fixture style.
