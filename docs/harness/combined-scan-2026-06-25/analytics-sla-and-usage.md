# Analytics, SLA & Usage — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: analytics-sla-and-usage | Group: Observability & Analytics
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

Notes on scope:
- Heatmap timezone bucketing is **correctly handled** and was ruled out: `getExecutionHeatmap` sends `tzOffsetMinutes` (observability.ts:114-122), the server shifts `DATE(created_at, ±N minutes)` in both SELECT and GROUP BY (metrics.rs:1990-2005), and the frontend grid keys cells by the same local calendar day (ExecutionHeatmap.tsx:104-117). No wrong-cell bug.
- All backend rollup divisions are guarded (`decided > 0`, `g_timed > 0`, `previous_week > 0`, `Math.max(1, …)`), so there is no NaN/crash path reaching the UI — hence no Critical. The findings are *wrong/misleading numbers*, which the rubric rates by financial/SLA impact.
- The named `sub_leaderboard/components/DetailPanel.tsx` does not resolve in the main `src/` tree of this checkout — it currently only exists under `.claude/worktrees/*`. Finding #4 is in its backing lib (`leaderboardScoring.ts`); confirm the path lands in the main tree before fixing.

## 1. Empty / low-activity SLA window renders a misleading red "0.0%" success rate
- **Severity**: High
- **Lens**: bug-hunter (+ ambiguity-guardian)
- **Category**: Misleading metric / no-data conflated with total failure
- **File**: src/features/overview/sub_sla/components/SLADashboard.tsx:95 (and :67) ; src-tauri/src/db/repos/communication/sla.rs:361-365
- **Scenario**: Open the SLA dashboard on a fresh install, or pick a 7d window in which a persona has only `cancelled` runs (or no runs at all). The per-persona list correctly shows "no agent data" (SLADashboard.tsx:114-115), but the four **global** stat cards always render. `global.success_rate` is `0.0`, so `formatPercent(0)` → "0.0%" and `slaColor(0)` → `rateToHealth(0)` → `critical` → a red card (statusTokens.ts:193-197). The dashboard screams "0.0% success — everything is failing" when the truth is "there is no data."
- **Root cause**: The backend returns `success_rate = 0.0` when the decided denominator is zero (sla.rs:361-365; same fallback for per-persona at :310-314 and daily at :428-432). `0.0` is indistinguishable from a genuine 0% success rate. The frontend has no "no decided runs" sentinel and paints `0.0` as a critical failure.
- **Impact**: A core reliability/SLA number is shown wrong and alarmingly red for the most common first-run and quiet-window states — erodes trust and could trigger false incident response. SLA number wrong → High.
- **Fix sketch**: Make "no decided runs" representable: have the backend return `Option<f64>`/`null` (or surface `decided`/`total_executions` already present) and have the dashboard render "—" / a neutral "No executions in window" state when `successful + failed === 0`, instead of a red "0.0%". Minimal alternative: in `SLADashboard`, when `Number(successful)+Number(failed) === 0`, override value to "—" and color to neutral.
- **Value**: impact=8 effort=3

## 2. `estimate_tokens` divides UTF-8 **byte** length, over-estimating tokens & cost preview ~2-4x for non-ASCII prompts
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Wrong cost math / unit error
- **File**: src-tauri/src/engine/cost.rs:63-65 (with CHARS_PER_TOKEN at :11)
- **Scenario**: A persona whose assembled prompt contains CJK, emoji, or accented Latin text is sent through `preview_execution` (executions.rs:748-803). `estimate_tokens` computes `text.len() as f64 / 3.8`. In Rust `str::len()` returns **bytes**, not characters: CJK is 3 bytes/char, emoji 4, accented Latin 2. A 1,000-character Japanese prompt reports ~3,000 "chars" → ~790 tokens instead of ~263, and the input/output cost preview inflates by the same ~3x.
- **Root cause**: The constant is documented "tokens per **character**" and the function is named/commented as a char-count estimate, but it is fed a byte count. ASCII-only prompts hide the bug (1 byte == 1 char).
- **Impact**: The user-facing pre-flight cost preview (`estimated_input/output/total_cost`, shown next to `monthly_spend`/`budget_limit`) is materially wrong for any non-English persona, discouraging valid runs or distorting budget expectations. Preview-only (not an automated gate per executions.rs:795), so Medium not High.
- **Fix sketch**: Use `text.chars().count()` (or a real tokenizer estimate) instead of `text.len()`. Add a test with a multibyte string asserting the estimate tracks char count, not byte count.
- **Value**: impact=6 effort=2

## 3. `formatPercent` rounds 99.95–99.99% up to "100.0%" — shows a perfect SLA when failures exist
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Rounding hides SLA breach
- **File**: src/features/overview/sub_sla/libs/slaHelpers.ts:3-5
- **Scenario**: A high-volume persona with 9,999 completed and 1 failed run has `success_rate = 0.9999`. `(0.9999*100).toFixed(1)` → `"100.0%"`, and `rateToHealth(0.9999)` ≥ 0.99 → `healthy` → a **green** "100.0%" card. The single failure is invisible; the dashboard claims a perfect SLA.
- **Root cause**: `toFixed(1)` rounds half-up at the display boundary with no guard that "100.0%" is only shown for an exact 1.0 rate. Same string feeds SLACard, PersonaRow and the embedded compact metric.
- **Impact**: Misleading SLA compliance figure — a user comparing to an external SRE dashboard sees "100%" where there were failures. SLA number wrong → Medium (magnitude small but it crosses the psychologically/contractually important 100% line, and green-washes a real failure).
- **Fix sketch**: Clamp the formatted display so it only prints "100.0%" when `rate >= 1` (or `successful === total`); otherwise floor to "99.9%". E.g. `const pct = rate >= 1 ? 100 : Math.min(99.9, rate*100); return pct.toFixed(1)+'%'`.
- **Value**: impact=5 effort=2

## 4. Leaderboard "Cost Efficiency" dimension is scored on **daily burn rate** but documented & displayed as **cost-per-execution**
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: Metric semantics mismatch / wrong ranking
- **File**: src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts:78-82, 127, 138-146 (header doc :7-9) — backs the named DetailPanel.tsx cost stat (resolves under `.claude/worktrees/*` in this checkout)
- **Scenario**: Two agents: A runs 1,000 cheap calls/day ($0.001 each → $1.00/day burn); B runs 1 expensive call/day ($0.50 each → $0.50/day burn). `scoreCostEfficiency(signal.dailyBurnRate, fleetAvgCost)` (called at :127 passing `dailyBurnRate` into a param literally named `costPerExec`, with `fleetAvgCost` = avg of `dailyBurnRate` at :116-118) ranks A as *less* cost-efficient because its absolute daily burn is higher — even though A's $/exec is 500× cheaper. The radar/leaderboard "cost" ranking therefore penalizes cheap high-throughput agents, while the **raw value shown beside it** (`$${costPerExec.toFixed(3)}`, :146) is a genuine cost-per-exec — so the score and the number next to it disagree.
- **Root cause**: The dimension is computed from daily burn rate, but the module header (:7-9), the parameter name, and the displayed `raw` all say "cost per execution." Two different quantities are conflated under one label. (Secondary: the `Math.max(1, recentExecutions/7)` floor at :139 over-states the displayed $/exec by up to 7× for agents with <7 recent runs.)
- **Impact**: Leaderboard cost ranking and the "biggest opportunity" cost callout are misleading — they can rank an efficient agent as wasteful. Cost number/ranking wrong → Medium.
- **Fix sketch**: Decide the intended semantic and make all three agree. Either score on the already-computed `costPerExec` (pass it, and average `costPerExec` for the fleet benchmark), or rename the dimension/raw/doc to "daily spend." Add a test pinning the cheap-high-throughput vs expensive-low-throughput ordering.
- **Value**: impact=5 effort=4

## 5. Cost preview model pricing: substring matching + silent default-to-Sonnet, with undocumented/stale rate constants
- **Severity**: Medium
- **Lens**: ambiguity-guardian (+ bug-hunter)
- **Category**: Undocumented rollup constants / wrong cost for unmatched models
- **File**: src-tauri/src/engine/cost.rs:15-60 (default branches :33-35 and :57-59)
- **Scenario**: (a) A BYOM / local / Ollama model (the app exposes BYOM per project memory) whose real marginal cost is ~$0 falls through every `contains(...)` branch and is priced at the **Sonnet default** ($3 in / $15 out per 1M), so the preview shows a non-trivial dollar cost for a free model. (b) `"gpt-4-turbo"` matches the `contains("gpt-4")` branch and is billed at the legacy GPT-4 rate ($30/1M) rather than its own much lower rate. (c) The constants carry no source or as-of date ("approximate list prices — actual pricing may vary by contract"), so they will silently drift from reality over time with nothing flagging staleness.
- **Root cause**: Naive ordered substring matching with a catch-all `else` that assumes a paid mid-tier model, and hard-coded price literals with no provenance, no "unknown model" signal, and no test pinning representative model→price mappings.
- **Impact**: The pre-flight cost preview is wrong for local/BYOM models (over-charges a $0 model) and for unmatched commercial variants; numbers drift unnoticed as vendor prices change. Preview/advisory only → Medium.
- **Fix sketch**: Return an explicit "unknown/unpriced" state (e.g. `Option` price → preview shows "—" / "cost unknown") instead of defaulting to Sonnet; key prices off a small documented table with an `as_of` date; and add a unit test asserting opus/sonnet/haiku/gpt-4o/local-unknown each map to the intended rate so drift is loud.
- **Value**: impact=5 effort=4
