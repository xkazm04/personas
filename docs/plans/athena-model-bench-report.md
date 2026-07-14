# Athena model/effort bench — results & analysis

Track B of `docs/plans/athena-live-conversation-layer.md` · run 2026-07-14 · 1,026 scored turns (+45 rate-limit retries) · corpus v2 (38 scenarios × 6 decision-ability classes × 3 reps × 9 cells) · all turns on subscription auth (zero marginal $) · distilled fixture prompt (real `PERSONAS_DUMP_PROMPT` replay is the documented follow-up) · scored by the production dispatcher via `athena-bench-validate`.

## Analysis (read this first — the raw gate table below is stricter than the truth)

### Headline findings

1. **Reinforced Sonnet-high beat the Opus baseline on accuracy.** `s-high-r` scored **96.5%** vs o-base's **93.9%**, with better first-token latency (3.8–4.2s vs 5.6s) at similar total time. The four lessons-learned doctrine rules (delegate-never-grind, act-don't-promise, one-line JSON, multi-op completeness) fixed every v1 Sonnet gap they targeted at high effort: tool_selection 28→30/30, delegate 14→15/15.
2. **Sonnet-medium is the speed sweet spot**: 93.0% (statistically at baseline) at **30% lower p50** (6.3s vs 9.1s) and 25% lower p90 — and 100% on awareness, restraint, and format.
3. **The effort dial barely moves Opus** on this corpus: o-low matched o-base exactly (93.9%) at 16% lower latency. Opus@low is a free latency win for main turns, though below the 30% promotion gate.
4. **Reinforcement backfires at low effort.** `s-low-r` regressed awareness 94→78%: the "acting means emitting the op" rule overrode the "don't re-spawn work already running" nuance — low reasoning effort can't hold both rules in tension. Doctrine strength must be matched to reasoning depth.
5. **Opus has a confident-memory failure mode Sonnet doesn't.** All three Opus cells failed the two-op scenario 3/3 the same way: skipping the `write_fact` because the fact was *"already in your notes"* — it wasn't; nothing in the prompt says so. Sonnet went 100%. Worth a constitution line: *never claim a fact is already stored unless recall shows it.*
6. **Restraint is a solved class**: 18/18 for every cell — no model at any effort fired ops on smalltalk, hypotheticals ("what if I asked you to delete all my goals?"), or vague musings.

### Why the strict gate table says "not certified" everywhere

Two scenarios turned out to be **corpus miscalibrations**, not model failures, and they dominate the `gated_discipline` deltas:

- `gated-assign-team` failed **27/27 across every cell including baseline** — the bench prompt carries no team roster, so `assign_team` needs a `team_id` the model cannot know. Every model asked "which team?" instead of hallucinating an id — arguably the *correct* behavior. Fix in corpus v3: seed a team roster, or accept a clarifying reply as a pass.
- `gated-delete-goal` — no goal id/list in the prompt either. Opus-base guessed from context and passed; Sonnet asked for confirmation (defensible, maybe preferable). Same v3 fix: seed goals into the prompt.

Excluding `gated-assign-team`, `s-high-r`'s only true accuracy delta vs baseline is one delete-goal clarify-vs-guess judgment call.

### Routing recommendations (feeding P3/P4 of the live-conversation plan)

| Turn class | Recommendation | Basis |
|---|---|---|
| **Aside turns / status summaries** (P3b — no OP grammar, awareness-heavy) | **Sonnet-5 @ medium** | 100% awareness/restraint/format, 30% p50 win, 35% faster first token |
| **Auto-titling & micro-summaries** (no awareness needed) | **Sonnet-5 @ low** | 91%+ overall but its misses don't apply here; 40% p50 win, p90 9.2s vs 19.3s |
| **Main conversational turns** | **Stay Opus for now**; `s-high-r` is the promotion candidate after corpus v3 + an LLM-judge pass | s-high-r already beats baseline accuracy; remaining deltas are calibration noise |
| **Opus effort** | Consider defaulting main turns to **Opus @ low** | identical accuracy to baseline, 16% latency win, zero risk found |
| **Constitution (all models)** | **Adopt the four reinforcement rules** — but gate rule 2 ("acting means emitting the op") on effort ≥ medium | lifted Sonnet-high above baseline; harmed only the low-effort cell |

### Method lessons (bake into the next run)

- **v1's dominant failure was the bench's own prompt**, not any model: an under-taught op envelope (`{"op":"use_connector"}` vs `{"op":"propose_action","action":"use_connector"}`) failed every cell equally, and two scenarios referenced capabilities that don't exist. A benchmark of decision ability is only as honest as its grammar teaching — replaying real `PERSONAS_DUMP_PROMPT` snapshots is the fix and remains the follow-up.
- Timeouts on delegate scenarios are decision failures (the model inlined the work), not infra — v1 mis-filed them.
- The campaign needed process isolation (renamed node binary + direct `claude.exe` spawns + out-of-repo input mirror + supervisor relaunch loop) to survive parallel development on the same machine; three unisolated runs were killed mid-campaign.
- LLM-judge prose scoring is still deliberately un-run; `results.jsonl` carries every `turnText` for an offline judge pass.

---

## Raw generated tables

Generated 2026-07-14T17:57:44.978Z · 1026 scored runs (45 infra failures excluded from accuracy) · corpus v2

## Per-cell summary

| cell | model | effort | runs | pass % | p50 first-token | p50 total | p90 total |
|---|---|---|---|---|---|---|---|
| o-base | claude-opus-4-8 | default(high) | 114 | 93.9 | 5.6s | 9.1s | 19.3s |
| o-med | claude-opus-4-8 | medium | 114 | 92.1 | 5.3s | 8.6s | 16.8s |
| o-low | claude-opus-4-8 | low | 114 | 93.9 | 4.5s | 7.6s | 15.8s |
| s-high | claude-sonnet-5 | high | 114 | 93.0 | 3.8s | 8.3s | 24.7s |
| s-med | claude-sonnet-5 | medium | 114 | 93.0 | 3.6s | 6.3s | 14.4s |
| s-low | claude-sonnet-5 | low | 114 | 91.2 | 3.1s | 5.7s | 10.9s |
| s-high-r | claude-sonnet-5 | high **+R** | 114 | 96.5 | 4.2s | 8.3s | 22.8s |
| s-med-r | claude-sonnet-5 | medium **+R** | 114 | 93.0 | 3.9s | 6.5s | 12.3s |
| s-low-r | claude-sonnet-5 | low **+R** | 114 | 91.2 | 3.5s | 5.5s | 9.2s |

## Accuracy by class (pass/runs)

| cell | awareness | delegate_vs_inline | format_contract | gated_discipline | restraint | tool_selection |
|---|---|---|---|---|---|---|
| o-base | 18/18 | 14/15 | 12/15 | 15/18 | 18/18 | 30/30 |
| o-med | 18/18 | 14/15 | 12/15 | 13/18 | 18/18 | 30/30 |
| o-low | 18/18 | 14/15 | 12/15 | 15/18 | 18/18 | 30/30 |
| s-high | 18/18 | 14/15 | 15/15 | 13/18 | 18/18 | 28/30 |
| s-med | 18/18 | 15/15 | 15/15 | 13/18 | 18/18 | 27/30 |
| s-low | 17/18 | 13/15 | 15/15 | 14/18 | 18/18 | 27/30 |
| s-high-r | 18/18 | 15/15 | 15/15 | 14/18 | 18/18 | 30/30 |
| s-med-r | 17/18 | 13/15 | 15/15 | 14/18 | 18/18 | 29/30 |
| s-low-r | 14/18 | 14/15 | 15/15 | 14/18 | 18/18 | 29/30 |

## Gate verdicts vs o-base

Gates: accuracy drop ≤ 2pts per class; ZERO new fails in restraint, gated_discipline; p50 total latency win ≥ 30%.

### o-med — ❌ not certified

- awareness: 100% vs 100% (+0.0pts)
- delegate_vs_inline: 93% vs 93% (+0.0pts)
- format_contract: 80% vs 80% (+0.0pts)
- gated_discipline: 72% vs 83% (-11.1pts) ✗
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 100% vs 100% (+0.0pts)
- latency: p50 8.6s vs 9.1s (5% win)

### o-low — 🟡 quality parity, latency win < gate

- awareness: 100% vs 100% (+0.0pts)
- delegate_vs_inline: 93% vs 93% (+0.0pts)
- format_contract: 80% vs 80% (+0.0pts)
- gated_discipline: 83% vs 83% (+0.0pts)
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 100% vs 100% (+0.0pts)
- latency: p50 7.6s vs 9.1s (16% win)

### s-high — ❌ not certified

- awareness: 100% vs 100% (+0.0pts)
- delegate_vs_inline: 93% vs 93% (+0.0pts)
- format_contract: 100% vs 80% (+20.0pts)
- gated_discipline: 72% vs 83% (-11.1pts) ✗
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 93% vs 100% (-6.7pts) ✗
- latency: p50 8.3s vs 9.1s (8% win)

### s-med — ❌ not certified

- awareness: 100% vs 100% (+0.0pts)
- delegate_vs_inline: 100% vs 93% (+6.7pts)
- format_contract: 100% vs 80% (+20.0pts)
- gated_discipline: 72% vs 83% (-11.1pts) ✗
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 90% vs 100% (-10.0pts) ✗
- latency: p50 6.3s vs 9.1s (30% win)

### s-low — ❌ not certified

- awareness: 94% vs 100% (-5.6pts) ✗
- delegate_vs_inline: 87% vs 93% (-6.7pts) ✗
- format_contract: 100% vs 80% (+20.0pts)
- gated_discipline: 78% vs 83% (-5.6pts) ✗
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 90% vs 100% (-10.0pts) ✗
- latency: p50 5.7s vs 9.1s (37% win)

### s-high-r — ❌ not certified

- awareness: 100% vs 100% (+0.0pts)
- delegate_vs_inline: 100% vs 93% (+6.7pts)
- format_contract: 100% vs 80% (+20.0pts)
- gated_discipline: 78% vs 83% (-5.6pts) ✗
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 100% vs 100% (+0.0pts)
- latency: p50 8.3s vs 9.1s (9% win)

### s-med-r — ❌ not certified

- awareness: 94% vs 100% (-5.6pts) ✗
- delegate_vs_inline: 87% vs 93% (-6.7pts) ✗
- format_contract: 100% vs 80% (+20.0pts)
- gated_discipline: 78% vs 83% (-5.6pts) ✗
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 97% vs 100% (-3.3pts) ✗
- latency: p50 6.5s vs 9.1s (28% win)

### s-low-r — ❌ not certified

- awareness: 78% vs 100% (-22.2pts) ✗
- delegate_vs_inline: 93% vs 93% (+0.0pts)
- format_contract: 100% vs 80% (+20.0pts)
- gated_discipline: 78% vs 83% (-5.6pts) ✗
- restraint: 100% vs 100% (+0.0pts)
- tool_selection: 97% vs 100% (-3.3pts) ✗
- latency: p50 5.5s vs 9.1s (40% win)


_LLM-judge prose scoring: not run (deliberate follow-up; results.jsonl carries turnText for an offline judge pass)._
