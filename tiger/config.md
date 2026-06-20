---
type: tiger/config
app: Personas Desktop (Tauri 2 + React 19 + Rust)
engine_model: Claude Code CLI (`claude -p --output-format stream-json`)
last_scanned: 2026-06-20
---

# config.md — Personas Tiger overlay (THE per-app file)

This is the engine-vs-overlay seam. The `/tiger` skill (`.claude/skills/tiger/skill.md`)
is stack-agnostic; everything Personas-specific lives here. Sibling of `/uat` —
Tiger reuses `uat/`'s Character method but scopes it to the **LLM call sites only**.

## What counts as a call site (Personas)

There are **no direct Anthropic SDK calls for text.** Every text LLM call is a
**`claude -p --output-format stream-json` CLI spawn**. A "call site" = a Rust
function that **builds a prompt and sends it to a model** for a specific job
(persona execution, team synthesis, healing, KPI scan, idea generation, memory
compile, reflection, triage, …). Pure CRUD / DB / parsing / event code is out of
scope.

## The chokepoint(s) — one engine, many wrappers

The single point every text call flows through is the **Claude Code CLI**, but
there are **several spawn wrappers** layered on top — this fan-out is itself the
#1 Lens-1 finding (telemetry/caching/self-repair live in different places, or
nowhere, per wrapper):

| Wrapper | Where | Used by | Telemetry |
|---|---|---|---|
| `prompt::build_cli_args` → `CliProcessDriver::spawn` | `engine/prompt/cli_args.rs`, `engine/cli_process.rs` | the apex persona execution + streaming jobs | **full** — `parser.rs` extracts model / tokens / `total_cost_usd` → `PersonaExecution` row |
| `cli_text` / `cli_text_tracked` / `cli_text_inner` | `companion/athena_reaction.rs:419/429/451` | headless Athena/engine decisions (reactions, triage, kpi_derivation, kpi_binding, profile_synthesis) | `cli_text_tracked` → `companion_turn` ledger (origin/model/tokens/trigger_kind); `cli_text` = **untracked** |
| `base_cli_invocation` / `call_claude_oneshot` | `companion/prompt.rs`, `companion/brain/*` | brain synthesis (chat turn, recall_synthesis, reflection, consolidation) | partial (chat turn → `companion_turn`; brain oneshots mostly **untracked**) |
| `spawn_claude_and_collect` / `ai_artifact_flow::run_ai_artifact_task` | `commands/design/*`, `commands/credentials/ai_artifact_flow.rs` | design artifacts (smart_search, team_synthesis, credential_design, recipe_generation, semantic_lint) | cli_log captured; **no token/cost** |
| direct `Command::new` + `prompt::build_cli_args(None,None)` | `commands/infrastructure/*` (idea_scanner, standards_scan, task_executor, context_generation, kpi_scan, kpi_compose) | the headless scanners | stderr relay only; **no token/cost telemetry** |
| direct `reqwest::post` | `commands/ocr/mod.rs:182` | **Gemini** vision OCR (the one non-Claude text-ish path) | reads `token_count` from response metadata |

Stream parsing contract: `engine/parser.rs::parse_stream_line` (model / tokens /
`total_cost_usd` / session_id). Provider abstraction: `engine/provider/claude.rs`
(`ClaudeProvider`, CLI floor 2.1.181). Subscription auth is forced for headless
calls via `force_subscription_auth()` (strip `ANTHROPIC_API_KEY`, monthly only).

## Model selection (Lens-3 baseline)

- **Executions:** per-persona `ModelProfile` + the routing cascade
  `engine/model_routing.rs` (persona_id > category > universal; explicit profile
  wins). Default resolves to the account default (often `opus-4-8[1m]`).
- **Headless scanners / design artifacts:** mostly **hardcoded `claude-sonnet-4-6`**
  (idea_scanner, standards_scan, task_executor, context_generation, kpi_*,
  team_synthesis, athena_reaction).
- **Companion brain synthesis:** **hardcoded `claude-opus-4-8`** (consolidation,
  reflection, recall_synthesis) — deliberate "quality > speed" pin.
- **Smart search:** `claude-haiku` (settings default). **OCR:** `gemini-3.5-flash`.

> Lens-3 target: most hardcoded-Sonnet scanners and the Opus brain pins have
> never been benchmarked against a cheaper/stronger cell under a fixed Character
> input. That's the model-optimization backlog.

## Discovery globs (for `scan` / re-inventory)

```
src-tauri/src/engine/**            # runner, director, healing, evolution, build_session, kpi_*, model_routing, prompt, cli_process, parser, provider
src-tauri/src/companion/**         # session, brain/*, proactive/*, athena_reaction, orchestration/*
src-tauri/src/commands/design/**   # build_sessions, team_synthesis, reviews, analysis, smart_search, n8n_transform, template_adopt
src-tauri/src/commands/infrastructure/**  # idea_scanner, standards_scan, task_executor, context_generation, kpi_scan, kpi_compose, twin
src-tauri/src/commands/core/**     # memory_compile, memories
src-tauri/src/commands/credentials/**     # credential_design, ai_artifact_flow, auth_detect, foraging, auto_cred_browser
src-tauri/src/commands/{artist,ocr,obsidian_brain,recipes}/**
src-tauri/src/mcp_server/tools.rs  # llm_delegate (BYOM → local model)
```
Drift signal for `scan`: a call site's recorded model / prompt-builder fn name /
schema changing vs the note's frontmatter = re-assess.

## Lens 2 (live) — reuse the /uat harness

L1 is static (read the prompt builder + grounding in code). L2 runs the **real
call** with a Character-shaped input and judges the live output. Personas' live
harness is the same one `/uat` uses — see [`uat/env.md`](../uat/env.md):

- Start: `npm run tauri:dev:test` (lite + test-automation → HTTP server on `127.0.0.1:17320`).
- Preflight: `curl http://127.0.0.1:17320/health` → `{"status":"ok",...}`.
- Driver: `tools/test-mcp/lib/` (`Client`, `Bridge`, `DB`). DB side-effect checks
  via read-only SQLite (`DB()`).
- **HARD:** one app instance only (data-dir + keyring singletons → L2 is serial,
  cost-bounded); model latency 30–215s per call → budget 200s timeouts; reset AI
  state between Characters; never kill the user's running app.

## Lens 3 (benchmark) — the recipe that works

Per the skill's learned lesson: dispatch **one subagent per matrix cell** with the
Agent tool's `model` / `effort` params, fed the call site's **real system prompt**
(copied from the Rust prompt-builder) + a **fixed Character input**; force schema
JSON via the subagent `schema` option; use subagent wall-clock as the latency
proxy. **Judge cells with a separate model** (never the one under test); prefer
majority/adversarial for close calls. No external API keys needed.

For a true cost number, the streaming path's `parser.rs total_cost_usd` is the
ground truth — a live L2 run records it; the subagent matrix gives the
quality×latency comparison.

## Fixtures (preflight before any live run)

Mirror `uat/env.md`: ≥1 Persona per status a journey inspects; seeded
credentials/connectors for "wired" call sites (kpi_binding, credential_design,
OCR needs a Gemini key); a team for synthesis/reaction call sites; a goal/KPI row
for kpi_* call sites; a project with a context-map for idea_scanner /
context_generation / kpi_scan.

## Open questions (resolve before first `run --live`)

- [ ] **Lens-3 model matrix:** which models × efforts to sweep? (default proposal:
      `opus-4-8` / `sonnet-4-6` / `haiku-4-5` × `low|medium|high`).
- [ ] **First sample set for `--live`:** highest-value sites — `persona-execution-main`,
      `athena-main-chat-turn`, `idea-scanner`, `kpi-scan`, `team-synthesis`,
      `smart-search`. (Don't live-run all ~38 in one pass — cost-bound it.)
- [ ] **Gemini OCR cost/quality:** is `gemini-3.5-flash` the right floor, or should
      OCR route through the Claude-vision path (`ocr-claude-vision`) for consistency?
- [ ] **Untracked headless spend:** should `cli_text` (untracked) + the direct-spawn
      scanners adopt `companion_turn`-style cost stamping? (Lens-1 backlog item.)
