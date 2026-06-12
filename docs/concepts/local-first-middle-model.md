# Local-first middle model — the stronger-middle experiment

> Status: FOLLOW-UP, ready to run on a bigger device. Written 2026-06-12 as
> the handoff from the Snapdragon round (docs/plans/mixed-engine-byom.md §6–§7).
> Goal: find the smallest open model class at which the composer/validator
> pattern's economics flip positive — Claude composes requirements and
> validates; the open model does everything in the middle.

## 1. What exists and what was proven

The plumbing is **done and shipped** — nothing below requires new code:

- `DesignUseCase.engine_mode`: `"mixed"` (delegate as helper) and
  `"local_first"` (composer contract: Claude must not write deliverable
  content; one revision per section; falls back after 2 consecutive tool
  errors). Toggle cycles in the use-case Transform column.
- `llm_delegate` MCP tool in personas-mcp: Ollama `/api/chat`, 300s timeout,
  `num_predict=4096`, temperature 0.2, inline `<think>`-strip
  (reasoning-model-proof), JSONL audit per execution at
  `<exec_dir>/.claude/delegate-audit.jsonl`.
- Settings: `delegate_model` (Ollama tag; `auto` = first installed),
  `delegate_base_url` (default `http://localhost:11434`).

**Snapdragon X Elite verdict (CPU-only, 2026-06-11/12)** — six-team bulk
digest UC, same input across runs:

| | G full Claude | H2 mixed | I2 local_first (gemma3:4b) |
|---|---|---|---|
| Claude output tokens | 11,283 | 9,671 | 21,244 |
| Turns | 2 | 2 | 14 |
| Local calls | 0 | 1 | 13 ok (9.5k in / 5.1k out) |
| Wall / cost | 3:37 / $0.27 | 3:36 / $0.28 | 19:34 / $2.06 |

**Quality held; economics inverted.** The validator caught ~5
misattributions per round in the 4B output (wrong engineer credited, swapped
commit hashes) and repaired them — final output fully faithful — but
forensic validation + revision rounds + 14 turns cost more Claude tokens
than writing directly. Two structural findings:

1. **Reasoning models are unusable as delegates.** LFM2.5 emitted ~5× its
   answer as thinking (133s for one 300-word digest); `think:false` and
   `/no_think` both fail. The tool survives them now, but don't pick them.
2. **4B is below the trust threshold.** The error rate forces line-by-line
   validation — rewrite-equivalent cost.

## 2. The hypothesis

There is a middle-model capability threshold above which per-section error
rates drop low enough that the validator can **spot-check instead of
line-verify**, and the pattern's token shape becomes:

```
Claude: compose (~1-2k out) + sample-validate + assemble (~2-3k out)  ≈ 4-5k out
Local:  all content (5-10k tokens, free)
vs. full Claude: ~11k out
```

Expected flip: Claude output −50% or better, turns ≤ 6, no revision rounds
on faithfulness, wall time bounded by parallel local generation.

## 3. Experiment protocol (new device)

### Setup

1. Install Ollama; on NVIDIA hardware set `OLLAMA_NUM_PARALLEL=4` (or more)
   so per-team work orders can fan out — serialized generation was a 17-min
   wall on CPU; parallel + GPU should make the local leg ~1 min.
2. Pull candidates (non-reasoning instruct models only; one per class):
   - **8B class**: `llama3.1:8b` or `qwen2.5:7b-instruct` (lower bound — may
     still be under the threshold; cheap data point)
   - **12-14B class**: `gemma3:12b`, `qwen2.5:14b-instruct`, `phi4:14b`
   - **27-32B class**: `gemma3:27b`, `qwen2.5:32b-instruct` (expected sweet
     spot; needs ~20-24 GB VRAM at Q4)
   - Optional zero-hardware path: Ollama Cloud free tier (`OLLAMA_CLOUD`
     presets exist in the catalog; `delegate_base_url=https://api.ollama.com`
     — the tool's env plumbing supports it, an auth header is the only gap
     to check).
   - Avoid: anything with "thinking/reasoning" in the card (R1-distills,
     QwQ, LFM2.5) — see finding 1.
3. `set_app_setting delegate_model=<tag>` per round (bridge or Settings).

### Bench harness recipe (recreate per device, ~10 min)

The harness is a disposable bench persona; the original scripts were
transient. Recipe:

1. **Persona**: `create_persona` via the test bridge (`:17320/bridge-exec`,
   method `invokeCommand`) with one UC `uc_bulk_digest` whose
   `sample_input.team_logs` holds six synthetic team logs (~15 commit lines,
   2 open tasks marked `NOT DONE YET`, 1 review each — seeded generator in
   the 2026-06-11 session transcript, or regenerate: faithfulness checks
   need exact names/hashes to verify against). Description demands:
   per-team 300-400-word digest + global rollup with 5 bullets + a
   contributors table.
2. **Run matrix** per candidate model: one run `engine_mode` unset
   (full-Claude baseline — only needed once per device) and one
   `engine_mode="local_first"`. Set the mode by rewriting
   `design_context.useCases[0].engine_mode` via `update_persona`;
   execute via `execute_persona {personaId, useCaseId}`.
3. **Token extraction** (execution rows don't carry tokens): read the
   execution's `log_file_path` from `persona_executions` (SQLite, read-only
   URI mode) and parse the stream-json result event (`"total_cost_usd"`
   line) for `usage` {output_tokens, cache_creation_input_tokens,
   cache_read_input_tokens} + `num_turns`; local tokens from the
   delegate-audit JSONL (prompt_tokens/eval_tokens per call).
4. **Quality scoring** against the synthetic logs (programmatic +
   spot-read): all 6 teams covered; correct per-engineer commit counts;
   open tasks = exactly the `NOT DONE YET` lines; no invented items; the
   release-blocker note surfaced. Count misattributions BEFORE Claude's
   repairs by reading the delegate audit outputs vs the final assembly.

### Per-round metrics

| Metric | Source | Flip target |
|---|---|---|
| Claude output tokens | result event `usage` | ≤ 50% of baseline |
| Turns | result event | ≤ 6 |
| Revision work orders | delegate audit (repeat tasks per section) | 0–1 total |
| Local error rate | misattributions per section pre-repair | low enough for spot-check |
| Wall time | execution timestamps | ≤ 2× baseline |
| Quality | faithfulness checks on final output | no regressions vs baseline |

### Operational gotchas (paid for once already)

- Don't run benches while anything compiles — CPU contention stretched local
  calls 10× and killed a run on the 20-min engine ceiling. Same class of
  risk exists on GPU boxes with other GPU load.
- Editing `src-tauri/src/**` mid-run restarts the dev app and kills the
  execution (tauri watcher). Make all Rust edits before launching a run.
- The personas-mcp binary is NOT rebuilt by the dev watcher — after touching
  `mcp_server/`, run `cargo build --bin personas-mcp --features desktop`.
- Each run of the same persona injects memories from prior runs (it once
  learned "the delegate is unavailable" from a broken round and rationally
  refused the tool). Delete the persona's memories — or use a fresh
  persona — between model rounds.
- Execution ceilings: ~600s timeout on this path, 20-min hard engine
  ceiling. Budget the local leg accordingly (parallelism is the fix).

## 4. Decision tree after the experiment

- **Flip achieved at 12-14B** → make `local_first` the recommended mode for
  bulk/report-shaped capabilities; add a sampling-validator variant of the
  contract (validate 2 of N sections + the rollup); revisit BYOM v2 routing
  with the same middle model for headless calls.
- **Flip only at 27-32B** → viable on workstation/cloud-delegate setups;
  document hardware floor; Ollama Cloud becomes the default middle for
  smaller devices.
- **No flip even at 32B** → the composer pattern is structurally wrong for
  faithfulness-critical work; keep `local_first` for low-stakes bulk
  transforms only (translations, reformatting) and close the direction.

## 5. Related

- `docs/plans/mixed-engine-byom.md` — architecture, §6 token methodic,
  §7 first verdict.
- `docs/plans/athena-wake-window.md` — the headless-call batching layer
  (the complementary, already-proven token lever).
- `src-tauri/src/mcp_server/tools.rs` (`llm_delegate`),
  `src-tauri/src/engine/runner/mod.rs` (engine_mode + doctrine prompts).
