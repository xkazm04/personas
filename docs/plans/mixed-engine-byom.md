# Mixed Engine — Claude orchestrator, open model as delegate tool

> Status: design accepted 2026-06-11 (user direction), implementation in flight.
> Session: byom-mixed-engine (see `.claude/active-runs.md`).

## 1. Problem & positioning

Claude Code CLI became the app's universal LLM engine — deservedly: it is the
only engine that drives the full agentic loop (tools, MCP, budgets,
stream-json) reliably. The earlier BYOM attempt to *swap the provider under
the CLI* was removed for a hard reason: Claude Code CLI only speaks Anthropic
models (`engine/prompt/cli_args.rs` — provider env paths deleted 2026-05).
But full-Claude-everything has a real cost: an 8-team certification run burns
subscription quota on a long tail of mentally-trivial subtasks (summarize
these 12 commits, reformat this table, extract fields from this log,
classify this message) that a local 4–8B model handles fine.

**The mixed engine inverts the old BYOM question.** Instead of "which engine
runs the persona?", it asks "which subtasks inside a Claude-orchestrated run
can be delegated?" Claude Code stays the *only* execution engine and process
driver; the open model becomes a **tool in the orchestrator's hands** —
exactly how a senior engineer uses an intern.

## 2. What already exists (reuse map)

| Asset | Where | Reuse |
|---|---|---|
| Per-capability `model_override` (full ModelProfile shape) | `DesignUseCase` in `personas.design_context` JSON | `engine_mode` lands as a sibling field — no migration needed |
| MCP sidecar attached to every persona run | `engine/cli_mcp_config.rs::install_mcp_sidecar` → `--mcp-config` | delegate config rides the same env block (`PERSONAS_DELEGATE_*`) |
| `personas-mcp` stdio binary w/ 27 tools + reqwest HTTP pattern | `src-tauri/src/mcp_server/tools.rs` (`bridge_proxy`) | `llm_delegate` is tool #28, same dispatch + HTTP idiom |
| Ollama model catalog + presets + API-key setting | `src/lib/models/modelCatalog.ts`, `OllamaCloudPresets.ts` | local model ids + base_url defaults |
| BYOM policy with `TaskComplexity` routing rules (dormant) | `engine/byom.rs`, `settings/sub_byom` | v2: policy decides which headless calls delegate |
| Native Ollama HTTP client (deferred, feature-gated) | `engine/ollama.rs` | request/response types reference for the tool |
| Lab Arena (per-model scores/tokens/cost/duration) | `lab_arena_*` tables, `sub_lab/arena` | comparison harness candidate (v1 uses plain executions) |

## 3. Design

### 3.1 The knob — capability level

`DesignUseCase.engine_mode: Option<String>`:

- `null` / `"claude"` — today's behavior, full-Claude. Default.
- `"mixed"` — the run gets the delegate tool + offload doctrine.

Capability level (not persona level) because offloadability is a property of
the *work shape*, not the persona: the same QA persona's "summarize test run"
capability is offload-friendly while its "diagnose flaky test" capability is
not. Persona-level would be too blunt; per-step would be unmanageable.

### 3.2 The tool — `llm_delegate` in personas-mcp

```jsonc
{
  "name": "llm_delegate",
  "description": "Offload a SIMPLE, self-contained subtask to a fast local model
    (summarize, extract fields, classify, reformat, draft boilerplate text).
    The local model sees ONLY what you pass in — no conversation context, no
    tools, no files. Do NOT use for: reasoning, planning, code edits, anything
    requiring judgment or context you can't paste into `input`.",
  "inputSchema": {
    "task":   "one-line instruction, e.g. 'Summarize into 5 bullets'",
    "input":  "the full content to process (self-contained)",
    "format": "plain | json | markdown (optional, default plain)"
  }
}
```

- Reads `PERSONAS_DELEGATE_BASE_URL` (default `http://localhost:11434`) and
  `PERSONAS_DELEGATE_MODEL` from env (set by the sidecar installer).
- Calls Ollama `/api/chat`, `stream:false`, temperature 0.2, 120s timeout.
- Returns the text plus a one-line meta footer (model, eval/prompt tokens,
  duration) so the orchestrator and the transcript both see the offload cost.
- Appends a JSONL audit line to `<exec_dir>/.claude/delegate-audit.jsonl`
  (`{ts, model, task, prompt_tokens, eval_tokens, duration_ms, ok}`) — the
  comparison harness and a future provider_audit_log bridge read this.
- **Failure semantics: graceful.** Ollama down / model missing / timeout →
  the tool returns `isError:true` with a clear message; the orchestrator
  simply does the subtask itself. A mixed run can never fail *because* the
  local model failed. This is the property that makes `mixed` safe to leave
  on.

### 3.3 The wiring — runner

In `engine/runner` where the per-UC `model_override` already merges
(`execution_use_case_id` × `persona.design_context`):

1. Parse `engine_mode` from the resolved use case.
2. If `"mixed"` and the delegate settings resolve: pass
   `Some(DelegateConfig{base_url, model})` into `install_mcp_sidecar`, which
   writes the two env vars into the `personas-mcp` server entry.
3. Append a short **offload doctrine** section to the assembled prompt:
   when to delegate (bulk summarization, extraction, classification,
   reformatting over content already in hand), when not to (reasoning,
   planning, anything touching tools/files), and that delegate output must be
   reviewed before use. One paragraph — the tool description carries most of
   the weight.
4. Log a breadcrumb (`[mixed-engine] delegate tool armed: <model>`).

Settings (global, device-level — the local model is a property of the
machine, not the capability): `delegate_base_url`, `delegate_model` in the
settings table, defaulting to `http://localhost:11434` + the first installed
Ollama model when unset. v1 ships defaults + settings keys; the BYOM settings
tab gets the editor later.

### 3.4 Frontend

`UseCaseDetailPanel` (next to the existing model-override dropdown): an
"Engine" selector — `Claude (default)` / `Mixed — offload simple subtasks to
a local model`. Persists to `design_context.useCases[i].engine_mode`. Shows a
dot-status hint when Ollama isn't reachable (reuse the healthcheck pattern).

### 3.5 Explicitly out of scope (v2+)

- **Headless call sites** (`cli_text`, KPI scan/derivation/binding,
  auto-triage, ~10 hardcoded sonnet sites): the dormant
  `ByomPolicy.routing_rules` with `TaskComplexity::Simple` is the right
  steering wheel for these — wire after the capability-level loop proves out.
- Native Ollama as a full execution engine (`EngineKind::Ollama`): stays
  deferred; the mixed approach makes it less necessary, not more.
- Delegate-tool access to files/tools: never. Self-contained input only — it
  is what keeps the trust boundary trivial (local model can't act, only
  transform text it was handed).
- Ollama Cloud as delegate backend: the env vars already allow it
  (base_url + future api key header) — not wired in v1.

## 4. Device baseline (this machine, 2026-06-11)

Snapdragon X Elite (Oryon, ARM64), 64 GB RAM, Adreno GPU (no CUDA) — Ollama
runs CPU-only here. Right-sized delegate models: 4–8B instruct Q4. The model
catalog's local references (`gemma4`, `qwen3.5`) are tried first; fallback to
registry-known tags. Acceptance gate: ≥10 tok/s generation on a summarization
prompt — below that, delegation costs more wall-clock than it saves quota.

## 5. Comparison methodology (acceptance)

Same persona, same capability, same input — two executions:

| Metric | Source |
|---|---|
| Claude input/output tokens | `persona_executions.input_tokens/output_tokens` |
| Cost | `persona_executions.cost_usd` |
| Wall time | execution timestamps |
| Delegate calls + local tokens | `delegate-audit.jsonl` |
| Output quality | side-by-side read + (optional) one cli_text judge pass |

Success looks like: mixed run ships comparable output with measurably fewer
Claude output tokens (the offloaded subtask's generation moved local), at
acceptable wall-time cost. Failure looks like: the orchestrator burns more
tokens negotiating with the tool than doing the work — which would argue for
narrowing the doctrine, not abandoning the tool.

## 6. Live comparison results (2026-06-11, this device, lfm2.5 @ 53 tok/s)

Bench personas: "Engine Bench" (small digest UC) + "Engine Bench Bulk"
(six team logs → per-team digests + rollup). Same input per pair.

| Run | UC | Engine | Delegate calls | Cost | Wall |
|---|---|---|---|---|---|
| A | small | claude | — | $0.246 | 0:42 |
| B | small | mixed | 0 (armed; correct restraint) | $0.241 | 0:14 |
| C | bulk | claude | — | $0.275 | 3:33 |
| D | bulk | mixed | 7 fired, 6 failed (Ollama server handover mid-run) | $0.314 | 4:08 |
| E | bulk | mixed | 0 — see memory finding | $0.251 | 2:57 |
| F | bulk | mixed, clean | 1 ok (commit-count JSON, 55s local) | $0.289 | 4:11 |

**What was proven.** The full chain works: capability toggle → runner arms
sidecar → tool advertised only when armed → orchestrator delegates
*organically* (D fired six parallel per-team digests unprompted; F delegated
the mechanical counting) → JSONL audit. Failure semantics proven live by
accident: the Ollama server died mid-run (instance handover) and the run
completed anyway — the orchestrator absorbed six tool errors and did the
work itself.

**Emergent finding — memory poisoning.** Run D's failures produced an
`agent_memory` ("Local delegate was unavailable…"); run E, with that memory
injected, rationally skipped the armed tool. One bad infra day teaches a
persona to avoid delegation until the memory ages out. If mixed scales,
infra-failure observations should be excluded from durable memory or
TTL-tagged.

**Economics verdict.** No measurable per-execution savings: engine-identical
repeats vary by ~$0.03 (C $0.275 vs E $0.251), the same magnitude as any
delegation effect, because the ~20–37k-token per-execution prompt machinery
dominates cost and the delegated slice of output is cents. Wall time is
WORSE under mixed (local generation is serialized and slow). The
capability-level mixed engine is therefore a *resilience-proven architecture*
with niche value (very large delegated payloads), not a cost lever.

**Where the real quota lever is (v2 priority reordered).** The headless
`cli_text` family (Athena reactions, KPI scan/derivation/triage,
auto-triage verdicts — small prompts, simple judgments, fired constantly
during cert runs) can be *entirely replaced* by the local model per the
dormant `ByomPolicy` `TaskComplexity::Simple` routing — replacing whole
Sonnet calls beats delegating inside prompt-heavy executions by an order of
magnitude. Second lever: the 20–37k prompt machinery itself (prompt diet),
which mixed cannot touch.
