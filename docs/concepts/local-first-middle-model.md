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

## 5. First result on a bigger device — 14B round (2026-06-12, RTX 4090)

Device: RTX 4090 (24 GB), Ryzen 7 7800X3D, 64 GB RAM. Ollama 0.20.5,
`qwen2.5:14b-instruct` (non-reasoning instruct, ~90 tok/s on GPU — 9× the
Snapdragon CPU floor). Same six-team bulk-digest UC, deterministic synthetic
input (six teams, 90 commits, exact authors/hashes, two `NOT DONE YET` lines
each, one review each, one release blocker). Engine: Opus 4.8. Harness:
`C:\Users\kazda\kiro\.byom-bench\` (disposable, outside the repo).

> Methodology note (paid for once): the CLI stream-json **per-message**
> `usage.output_tokens` and the result event's nested per-turn fields BOTH
> undercount the final flush (a 15 KB deliverable reported as 66 output
> tokens). The only authoritative token total is the **result event's
> top-level `usage` object** — it equals the single-message baseline exactly.
> Also: the `personas-mcp` binary is not rebuilt by the dev watcher, so the
> first attempt ran against a stale binary with no `llm_delegate` tool and
> Claude silently fell back to writing everything itself. Rebuild
> (`cargo build --bin personas-mcp --features desktop`) before any delegate
> round, and confirm `grep -c llm_delegate` on the `.exe` > 0.

| Metric | Baseline (full Opus) | local_first @ 14B | vs baseline | Flip target | Met? |
|---|---|---|---|---|---|
| Claude output tokens | 7,716 | **18,065** | **+134%** | ≤ 50% | ❌ |
| Turns | 1 | 10 | 10× | ≤ 6 | ❌ |
| Revision work orders | — | 1 | — | 0–1 | ✅ |
| Cache read (cumulative) | 0 | 157,241 | — | — | — |
| Cost (CLI-billed) | $0.617 | **$1.170** | **+90%** | — | ❌ |
| Wall | 78 s | 210 s | +169% | ≤ 2× | ❌ |
| Delegate calls | 0 | 9 ok (6.2k in / 3.8k out local) | — | — | — |
| Final quality | faithful | faithful (89/90 hashes) | held | no regress | ✅ |

**Verdict: 14B does NOT clear the trust threshold — the economics invert the
same way 4B did, just less severely.** The composer chain worked
structurally (9 clean work orders: 6 team digests + rollup + table + a
commit-count pass; one revision round; no infra failures). But the 14B made
the *same classes* of error as the 4B — it **miscounted commits for 3 of 6
teams** in the contributors table (Atlas 5/4/3/3 instead of 4/4/4/3),
**fabricated commit URLs**, **swapped a hash** (Cobalt cold-start), and
**dropped the verbatim `NOT DONE YET:` prefixes** in one team. Claude caught
all of them — but only by **forensically validating every count and hash and
then re-emitting a cleaned 15 KB deliverable itself**. That re-emission is
why Claude *output* rose to 18 k tokens: the promise of "Claude composes &
validates, never writes deliverable content" broke because the middle was
untrustworthy enough to require a rewrite, not a spot-check. Even after
forensic repair, one hash (`8b5faad`) still leaked from the final output.

Two structural costs the 14B can't fix: (1) **multi-turn cache re-reads** —
10 delegate round-trips re-read a growing context for 157 k cumulative
cache-read tokens, a cost that scales with turn count regardless of delegate
quality; (2) **validate-then-re-emit** — as long as the validator can't
trust the middle enough to pass it through, Claude pays to write the
deliverable a second time. Both are properties of the composer pattern on
faithfulness-critical work, not of the model size alone.

**Decision-tree position:** not "flip at 12–14B." The doc's remaining branch
is "flip only at 27–32B" — `qwen2.5:32b-instruct` / `gemma3:27b` at Q4 fit
this box's 24 GB. The bet for 32B: a low enough error rate that the validator
*spot-checks instead of re-emits* (collapsing the 18 k re-emission) and the
revision round disappears (fewer turns → less cache-read). If 32B still
forces re-emission, the pattern is structurally wrong for faithfulness-
critical work and `local_first` should be scoped to low-stakes bulk
transforms (translation, reformatting) only — with the real near-term token
lever remaining the headless-call layer (§6 of mixed-engine-byom.md).

### 5.1 Cloud frontier middle — nemotron-3-ultra (550B) round (2026-06-12)

When 14B fell short, we tested the ceiling: NVIDIA **nemotron-3-ultra**
(550B total / 55B active, 256K ctx) via **Ollama Cloud** free tier
(`https://ollama.com/api/chat`, `Authorization: Bearer <ollama_api_key>`).
Same six-team UC, same input, Opus orchestrator.

**Wiring (shipped, three small edits — the doc's predicted "auth header gap"):**
- `mcp_server/tools.rs` `handle_llm_delegate`: reads `PERSONAS_DELEGATE_API_KEY`
  and sends `Authorization: Bearer` on `/api/tags` + `/api/chat`; adds
  `"think": false` to the body (nemotron is a reasoning model — without it
  `message.content` is empty and everything lands in the `thinking` field).
- `engine/cli_mcp_config.rs` `install_mcp_sidecar`: `delegate` tuple grew a
  third `Option<&str>` element → writes `PERSONAS_DELEGATE_API_KEY` into the
  sidecar env when set.
- `engine/runner/mod.rs`: resolves the existing `ollama_api_key` setting and
  threads it into `delegate_cfg`. Set `delegate_base_url=https://ollama.com`,
  `delegate_model=nemotron-3-ultra` (bare tag works direct; `:cloud` suffix is
  only for local routing), `ollama_api_key=<key>`. Rebuild **both** binaries
  (the app via the watcher, `personas-mcp` manually).

| Metric | Baseline | 14B local | **nemotron-3-ultra (cloud)** |
|---|---|---|---|
| Claude output tokens | 7,716 | 18,065 | **14,319** |
| Turns | 1 | 10 | **8** |
| Revision rounds | — | 1 | **0** |
| Cost (CLI-billed) | $0.617 | $1.170 | **$0.993** |
| Wall | 78 s | 210 s | **326 s** (cloud free tier) |
| Delegate calls | — | 9 | **7 ok** (4.3k in / 2.7k out) |
| Faithfulness | — | 89/90 hashes, miscounts | **90/90 hashes, 24/24 engineers, 0 miscounts** |

**Quality: nemotron-3-ultra CLEARS the trust threshold.** Perfect attribution,
zero miscounts, **no revision rounds** — Claude spot-validated and trimmed
exactly **one minor fabrication** (an invented "Ravi Suri is addressing this
follow-up" line in the Falcon digest) across the whole deliverable. This is
the first middle model where the validator could spot-check instead of
forensically rewrite. Capability scaled exactly as hypothesized: 4B → 14B →
550B monotonically reduced errors, revisions, and cost.

**But the economics STILL do not flip — and the round proves the blocker is
the contract, not the model.** Claude output stayed at 14.3k (≈2× baseline)
*despite a near-perfect delegate and zero revisions*. Root cause: the
`local_first` contract's **VALIDATE & ASSEMBLE** step makes Claude emit the
full ~15.7 KB assembled deliverable itself. The delegate offloads *generating*
content (2.7k local output tokens) but **not emitting it** — and emission, not
generation, dominates Claude's output-token cost. Output therefore cannot drop
below the deliverable size no matter how good the middle is. Add 8 turns ×
growing context (96.8k cache-read) and cloud latency (68 s cold start +
17–30 s/call serialized on the 1-concurrent free tier), and a trustworthy
550B middle still lands at +86% output / +60% cost / 4× wall vs full Claude.

**Revised decision-tree outcome — neither "flip at 12–14B" nor "flip at
27–32B" holds, because both assumed the model was the bottleneck.** At 550B
the model is no longer the bottleneck; the composer contract's re-emission is.
Two structural costs survive any model upgrade: (1) **re-emission** — Claude
rewrites the deliverable it just validated; (2) **multi-turn cache re-reads** —
each delegate round-trip re-reads a growing context. The only path to a flip
is a **contract redesign**, not a bigger model:
- **Assembly-by-reference**: Claude emits a skeleton with `{{insert delegate
  output N}}` placeholders and the runner stitches the raw delegate outputs in
  post-process — so Claude never re-emits the bulk content. This is the change
  that would actually move output below baseline.
- **Sampling validator**: validate 2-of-N sections + the rollup (not every
  line) — cheaper now that a 550B middle earns the trust to sample.

**Bottom line for cost reduction (2026-06-12):** `local_first` is *not* a
cost lever today for faithfulness-critical bulk work, at any model size,
under the current emit-the-whole-deliverable contract. For the **local /
small-model goal** (run the middle on your own hardware), capability is still
the blocker — 14B fails faithfulness; wait for nemotron-class faithfulness in
a ≤30B variant. For the **cloud-middle path**, capability is solved but the
contract must change first. The real near-term token lever remains the
headless-call layer (wake window + Simple-routing), per §6 of
mixed-engine-byom.md — deferred here by design.

## 6. Related

- `docs/plans/mixed-engine-byom.md` — architecture, §6 token methodic,
  §7 first verdict.
- `docs/plans/athena-wake-window.md` — the headless-call batching layer
  (the complementary, already-proven token lever).
- `src-tauri/src/mcp_server/tools.rs` (`llm_delegate`),
  `src-tauri/src/engine/runner/mod.rs` (engine_mode + doctrine prompts).
