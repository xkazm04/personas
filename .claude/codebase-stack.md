# Codebase Stack & Architecture — personas

> Hand-curated reference for `/research` and other skills. Refresh manually after major architecture or schema changes — this file does NOT auto-regenerate.
>
> Last reviewed: 2026-04-07 (verify against current `package.json`, `Cargo.toml`, and `src-tauri/src/db/models/persona.rs` before relying on specific versions).

---

## How /research Uses This File

Loaded in Phase 1 alongside `codebase-context.md` and `codebase-catalogs.md`.
This file answers questions the feature map can't:

- **Is this idea even a personas concept?** (e.g., "add hooks support" — yes, because the engine wraps Claude Code CLI which has hooks)
- **Where in the persona schema does this live?** (e.g., "rate limit per use case" → `PersonaParameter` not a top-level Persona field)
- **Does this idea conflict with the dual-process architecture?** (e.g., "run in browser" — no, this is a Tauri desktop app)

---

## 1. Architecture in One Paragraph

Personas is a **Tauri v2 desktop app** that wraps the **Claude Code CLI** (and Codex CLI) as its execution engine. The frontend is React 19 + TypeScript + Zustand + Vite + Tailwind 4. The backend is Rust (Tokio async runtime) with SQLite persistence via `rusqlite` (bundled). The two halves communicate via Tauri's IPC bridge — frontend calls Rust commands by name, Rust emits events back. Each persona is a configuration record that defines an agent identity, system prompt, model profile, connectors, triggers, and free parameters; when an execution fires, the Rust engine resolves credentials, builds CLI args, spawns the `claude` (or `codex`) binary, streams stdout JSON back to the frontend, and persists the trace.

---

## 2. Engine: Claude Code CLI Wrapping (CRITICAL)

**This is the single most important fact about personas:** the application does not implement an LLM client. It shells out to the `claude` binary on the user's `PATH` (or `claude-code` / `claude.exe` / `claude.cmd` on Windows) and treats it as the LLM provider. (Codex CLI was previously a secondary provider with the same shape but was removed — see "Codex provider was removed" below.)

### Provider abstraction

Defined in `src-tauri/src/engine/provider/mod.rs` as the `CliProvider` trait. **One concrete impl as of 2026-04-27:**
- `src-tauri/src/engine/provider/claude.rs` — `ClaudeProvider`, engine name `"Claude Code CLI"`, context file `CLAUDE.md`

`EngineKind::ALL = [EngineKind::ClaudeCode]`; the `from_str` impl maps the legacy setting string `"codex_cli"` back to `ClaudeCode` for back-compat. There is no `CodexProvider` and no `engine/provider/codex.rs` file. The `PromptDelivery` enum still has `PositionalArg` and `Flag(String)` variants tagged for Codex but they are dead-code without a provider impl. **Discovered in `/research` run 2026-04-27 (Hermes Agent compare); previous versions of this doc described a sibling Codex provider that no longer exists.**

`CliProvider` exposes:
- `binary_candidates()` — names to search PATH for
- `prompt_delivery()` — `Stdin` (claude) or `Argv` — how the prompt reaches the binary
- `build_execution_args(persona, model_profile)` → `CliArgs` — flag list per execution
- `build_resume_args(session_id)` → `CliArgs` — `--resume <id>` form
- `parse_stream_line(line)` → typed stream events (system_init, message, result, tool_use, etc.)
- `apply_provider_env(args, profile)` — env vars to inject (e.g., model overrides)

### How a persona execution actually runs

1. `engine/runner/mod.rs::run_execution` receives an execution request. **NOTE:** Earlier copies of this doc said `engine/runner.rs::run_persona`; that anchor is stale — `runner` is a directory (`mod.rs` + `stages.rs` + `env.rs` + `credentials.rs` + `globals.rs` + `HOOKS_DESIGN.md`), and the entry function is `run_execution`. The `run_persona_synchronous` wrapper at `engine/management_api.rs:~1525` is the Tauri-command-level caller; `run_persona_node` at `engine/pipeline_executor.rs:~319` is the pipeline-step caller. Both go through `run_execution`. Anchor correction from `/research` run 2026-05-16 (Hermes `/goal` reaffirm).
2. Resolves credentials (`engine/credential_negotiator.rs`)
3. Picks a provider (`engine/failover.rs` → `provider::for_engine_name`)
4. Calls `provider.build_execution_args(persona, model_profile)` — which delegates to `engine/prompt.rs::build_cli_args`
5. The resulting flag list always includes:
   - `-p` (`--print` mode)
   - `--input-format` `text`
   - `--output-format` `stream-json`
   - `--verbose` (required by `--print + stream-json`)
   - `--dangerously-skip-permissions` (sandbox handled at app level via IPC auth)
   - `--model <profile.model_id>` if a model profile is set
6. Spawns the binary with stdin pipe; pipes the compiled prompt (`engine/prompt.rs`) into stdin
7. Reads stdout line-by-line, parses each line via `engine/parser.rs::parse_stream_line` into typed `StreamLineType` events
8. Emits Tauri events to the frontend per stream line
9. On `result` event, persists cost/duration/tokens to `executions` table
10. On crash/timeout, kicks `engine/healing.rs` to attempt recovery

### Session resume

`build_resume_args(session_id)` constructs `claude --resume <id> -p --output-format stream-json …`. Used by chat sessions to continue a prior conversation without re-injecting full history. Stored in `chat_session_context` table.

### IPC authentication

`src-tauri/src/ipc_auth.rs` requires every Tauri command to carry an HMAC token derived at startup. Prevents other processes from invoking commands directly via the Tauri runtime. Stampede detector and retry depth cap added recently.

### BYOM (Bring Your Own Model)

`src-tauri/src/engine/byom.rs` allows pointing the CLI at a non-Anthropic OpenAI-compatible endpoint by setting `ANTHROPIC_BASE_URL` (claude) or equivalent env vars in `apply_provider_env`. Routing decided by `engine/llm_topology.rs`.

### `build_cli_args` is the 30-caller funnel point (CRITICAL for flag changes)

`src-tauri/src/engine/prompt.rs::build_cli_args(persona, model_profile)` is called from **~30 sites** across the codebase: production runner, lab `test_runner` (5+ sites), eval, build sessions (3 sites), design analyses (×3), reviews (×2), smart_search, team_synthesis, template_adopt (×5), n8n_transform (×2), credential helpers (shared, query_debug ×2, schema_proposal, auto_cred_browser, nl_query), infrastructure (context_generation, idea_scanner, task_executor), obsidian_brain semantic_lint, artist, teams. **Any change to base CLI flags inside this function automatically propagates to every caller.** This is a 30× leverage point — `/research` findings about CLI flags should always anchor here, not at individual call sites.

The base flag set as of run 7 (2026-04-09) is:
```
-p  -  --output-format stream-json  --verbose  --dangerously-skip-permissions  --effort <level>
[+ --model <id>] [+ --max-budget-usd <n>] [+ --max-turns <n>]
```

Plus `apply_provider_env` injects per-provider env vars (OLLAMA_*, ANTHROPIC_*, OPENAI_*) and `env_removals` strips `CLAUDECODE`/`CLAUDE_CODE` to prevent self-recursion.

`build_resume_cli_args(session_id)` is the parallel function for `--resume` mode and pins the same `--effort medium` default so resumed sessions stay on the same effort policy.

### The companion (Athena) does NOT use `build_cli_args` — it has its own spawn + stream path

Discovered in `/research` run 2026-05-23 (Athena dynamic-chat). The Athena companion is NOT one of the ~30 callers of `build_cli_args`. It spawns the `claude` CLI through its **own bespoke arg builder** at `src-tauri/src/companion/session.rs::run_cli` (~line 766) with a different flag set (`--system-prompt-file`, `--exclude-dynamic-system-prompt-sections`, `--model claude-opus-4-7` pinned, env `CLAUDE_CODE_FORK_SUBAGENT=1`) and its own stream loop (`session.rs:880-945`) that emits `companion://stream` events — **separate from both** the main runner's legacy-text channel and the structured `EXECUTION_EVENT` channel. Implications for `/research` findings about CLI flags or stream parsing:
- A flag change in `build_cli_args` does NOT reach Athena. Companion-scoped CLI-flag findings must edit `session.rs::run_cli` directly.
- Athena's frontend stream handling is bespoke (`CompanionPanel.tsx` + `extractAssistantText`/`extractStreamPhase`/`extractAssistantTextDelta` + `operationalSteps`), NOT `useStructuredStream`. Don't assume the main-chat streaming hooks apply.
- As of 2026-05-23, `run_cli` passes `--include-partial-messages` (token-level `text_delta` streaming) and the panel renders TodoWrite tool calls as an inline operational checklist (`OperationalThread`).
- Companion background jobs (`companion/jobs/`) only surface as chat cards for the `connector_use` kind; `scan_codebase`/`memory_curation_run` flow to system episodes / dedicated UIs. Jobs can report intermediate progress via the `JobProgress` reporter (event-only `progress_text` on `companion://job`).

**Codex provider was removed (2026-04-27).** Earlier versions of this doc said `engine/provider/codex.rs::build_execution_args` builds Codex args independently. That file no longer exists; only ClaudeProvider remains. CLI-flag changes only need to be evaluated for Claude Code applicability — there is no second provider to coordinate with. If Codex (or any new CLI engine) is re-introduced, sibling providers would need their own `build_execution_args` impl that does NOT call `prompt::build_cli_args` (since that funnel pins Claude-specific flags like `--effort`).

### Lifecycle hooks: `hooks_sidecar.rs` is narrow (Claude Code's NATIVE hooks only)

`src-tauri/src/engine/hooks_sidecar.rs` writes a `.claude/settings.json` sidecar into each per-persona `exec_dir` so **Claude Code's NATIVE hooks** (`SessionStart`, `Stop`, `PreCompact`) fire and drop session transcripts into a `.personas/session_queue.jsonl` for the memory-capture pipeline (Karpathy run, 2026-04-08). It is **opt-in via env var** `PERSONAS_HOOKS_SIDECAR=1`.

**Personas does NOT have its own runner-level lifecycle hook surface.** There is no `pre_tool_call` / `post_tool_call` / `pre_llm_call` / `post_llm_call` / `on_session_start` / `on_session_end` plugin hook system at the personas Rust layer (zero hits across the codebase as of `/research` run 2026-04-27 Hermes compare). The natural attachment point for such a surface is `engine/runner/mod.rs::run_persona`'s stream-line `match &line_type` block (~line 1301 — see "Two parallel stream channels" below) and `engine/event_registry.rs`. Adding this is a discrete future finding, not an existing primitive.

When `/research` findings propose plugin extensions to the runner, distinguish:
- "delegate to Claude Code's native hook" → use `hooks_sidecar.rs` pattern (write `.claude/settings.json`)
- "personas-specific runner hook" → does not exist; would need to be built first

### `assemble_prompt` brackets the persona content with TWO autonomy directives (top + bottom)

Discovered in `/research` run 12 (2026-04-12, Andrej Karpathy skills video). `engine/prompt.rs::assemble_prompt` prepends `EXECUTION_MODE_DIRECTIVE` at line 95 (constant at line 1462) **and** appends a second "EXECUTE NOW" reinforcement at line 497-511 which repeats the "Act autonomously — do NOT ask questions" instruction. Persona-authored `structured_prompt.customSections` (line 252) land **between** the two directives, so a template cannot override "don't ask questions" via customSections alone — any such override would be contradicted at the bottom of the prompt by the EXECUTE NOW block.

**Implication for /research:** any finding that proposes changing default prompt behavior (discipline mode, clarification style, verification rituals, early-exit rules) must touch BOTH sites (line 95 + line 497-511), or it only half-works. This is the "pre + post sandwich" pattern — assume it applies until verified otherwise. See the Karpathy discipline handoff at `.planning/handoffs/2026-04-12-karpathy-discipline-override.md` for the reference implementation of a dual-site directive override.

### Effort flag mechanism (CLI 2.1.94 hardening)

`engine/prompt.rs::DEFAULT_EFFORT = "medium"` is the personas-pinned default effort level. CLI 2.1.94 silently changed the implicit CLI default from `medium` to `high` for API-key/Bedrock/Vertex/Foundry/Team/Enterprise users; personas pins `medium` everywhere via `--effort` so behavior is deterministic across CLI versions and account tiers. Override path:
- `ModelProfile.effort: Option<String>` (`engine/types.rs:285`) — when set, replaces the default
- Lab path: `TestModelConfig.effort: Option<String>` (`engine/test_runner.rs:58`) is plumbed through to the constructed `ModelProfile` in `execute_scenario`
- Frontend: `src/lib/models/modelCatalog.ts::selectedModelsAndEffortsToConfigs(models, efforts)` produces a cartesian product (model × effort) that the lab panels use to vary effort alongside model. `DEFAULT_EFFORT = 'medium'` and `EFFORT_LEVELS = ['low', 'medium', 'high']`.
- Persona-level overrides should reuse the existing `parameters: Option<String>` JSON column via a `PersonaParameter` of type `select` — NOT a new schema column (per the runtime-knob rule).

### Two parallel stream channels: `executionOutput` (legacy text) vs `EXECUTION_EVENT` (structured)

The runner emits stream lines on **two channels in parallel**, and the frontend subscribers split between them:

- **Legacy text channel** — `executionOutput: string[]` in `executionSlice` (Zustand). One string per stream line, classified by `classifyLine`. Consumed by `useExecutionStream` which **filters to text-only** (`classifyLine(l) === 'text'`). The chat (`ChatTab` / `StreamingBubble`) and `PersonaRunner` terminal both read this channel. **Tool events are dropped here.**
- **Structured channel** — Tauri event `EXECUTION_EVENT` (string `'execution-event'`), payload is the discriminated `StructuredExecutionEvent` union. Subscribed via `useStructuredStream(executionId, handlers)` which filters by execution id and dispatches by variant. Consumed by the execution inspector, replay sandbox, lab event stream, file-change tracker, and (as of 2026-04-25) the chat plan panel.

**Routing rule for /research findings:** any new tool semantics that should reach the chat surface (TodoWrite plan rendering, tool_result inlining, image preview, etc.) must go through the structured channel — the legacy text channel will silently drop them. The structured-event triplet that needs lockstep updates:

1. `src-tauri/src/engine/types.rs::StructuredExecutionEvent` — new variant + `StreamLineType` mapping
2. `src/lib/types/terminalEvents.ts` — TS interface + union member (HAND-MAINTAINED, not auto-generated by ts-rs)
3. `src/lib/eventRegistry.ts::ExecutionEventPayload` — TS discriminated-union member (also hand-maintained, separate from terminalEvents.ts)
4. `src/hooks/execution/useStructuredStream.ts` — `StreamHandlers` field + dispatch case

The Rust runner's `match &line_type` block in `engine/runner/mod.rs` (~line 1301) is the funnel where stream lines are mapped to structured events — every new variant needs an arm there.

This was added after `/research` run on 2026-04-25 (Simon Scrapes Claude desktop walkthrough → TodoWrite plan rendering).

### Implications for /research

When an idea touches **any** Claude Code CLI feature, it's almost certainly relevant:
- Hooks (PreToolUse/PostToolUse/Stop/etc.) → personas could surface them as persona-level event subscriptions
- Slash commands → potentially compilable into persona use cases
- MCP → personas integrates **both directions**: INBOUND (consumes external MCP servers as tools — `commands/credentials/mcp_gateways.rs`, `commands/credentials/mcp_tools.rs`, `engine/mcp_tools.rs`, `db/repos/resources/mcp_gateways.rs`) and OUTBOUND (acts as an MCP server exposing personas tools to Claude Code/other clients — `mcp_server/` module + `mcp_bin.rs` binary). Ideas about MCP are direct hits — verify which direction the idea targets before scoring.
- Settings.json → persona settings could project into per-persona settings overrides
- Subagents → personas already implements something analogous via pipelines and chains
- Session resume → already used; ideas about better session management apply
- Output styles → currently unused in personas, could be a feature gap

---

## 3. Persona Schema (data shape)

From `src-tauri/src/db/models/persona.rs::Persona`. Use this to judge whether an idea is a persona-level concept, a parameter, or a separate entity.

### Identity & display
| Field | Type | Notes |
|---|---|---|
| `id` | String | UUID |
| `project_id` | String | grouping by workspace |
| `name` | String | required |
| `description` | Option<String> | |
| `icon` | Option<String> | Lucide name or URL |
| `color` | Option<String> | hex |
| `enabled` | bool | hard kill switch |
| `sensitive` | bool | hides from non-privileged sessions |
| `headless` | bool | runs without UI surfacing |

### Prompts & build
| Field | Type | Notes |
|---|---|---|
| `system_prompt` | String | required, raw user-authored prompt |
| `structured_prompt` | Option<String> | JSON of structured prompt sections (identity/instructions/tools/examples/errorHandling) — **same shape as templates** |
| `last_design_result` | Option<String> | JSON snapshot of most recent AI design output |
| `design_context` | Option<String> | JSON envelope `DesignContextData` (see below) |

### Execution control
| Field | Type | Notes |
|---|---|---|
| `max_concurrent` | i32 | parallel execution cap |
| `timeout_ms` | i32 | per-run timeout |
| `model_profile` | Option<String> | references a model profile (claude-opus, claude-sonnet, codex-…, byom-…) |
| `max_budget_usd` | Option<f64> | hard $ cap per run |
| `max_turns` | Option<i32> | max LLM iterations per run |
| `notification_channels` | Option<String> | JSON list of channels (messaging/email/etc.) |

### Trust
| Field | Type | Notes |
|---|---|---|
| `trust_level` | enum | `manual` / `verified` / `revoked` |
| `trust_origin` | enum | `builtin` / `user` / `system` |
| `trust_verified_at` | Option<String> | ISO timestamp |
| `trust_score` | f64 | numeric reputation |

### Free parameters
| Field | Type | Notes |
|---|---|---|
| `parameters` | Option<String> | JSON array of `PersonaParameter` |

`PersonaParameter` shape (number/string/boolean/select with default, value, min/max, options, unit). Adjustable at **runtime without rebuild**. Templates inject these into prompts via `{{param.key}}`. **Any "make X configurable" idea should propose a free parameter, not a code change.**

### Design context envelope

`design_context` column (Option<String>) deserializes to `DesignContextData`:
- `design_files` — files & references from AI design phase (`DesignFile { name, content, type }`)
- `credential_links` — `connector_name → credential_id` map
- `use_cases` — list of `DesignUseCase` (id, title, description, category, execution_mode, sample_input, time_filter, input_schema, suggested_trigger, model_override, notification_channels, event_subscriptions)
- `summary` — optional human summary
- `connector_pipeline` — chronological `ConnectorPipelineStep[]` (connector_name, action_label, order)

### Runtime-derived (not stored)
- `PersonaHealth` — derived from recent execution outcomes (`healthy` / `degraded` / `failing` / `dormant`), success rate, sparkline
- `PersonaSummary` — sidebar badge (trigger count, last_run_at, health)

### What is NOT on the persona

These exist as separate entities, related by `persona_id`:
- **Triggers** (`triggers` table) — webhooks, cron, polling, file watcher, clipboard, smee relay
- **Memories** (`memories` table) — episodic agent memory per persona (different from this Obsidian vault — that's *user* memory; this is *agent* memory)
- **Shared memories** (`team_memories` table, to be renamed `shared_memories`) — memory entries reusable across multiple personas. Originally scoped to a team via `team_id`; being generalized so any persona can connect to a shared memory via a new `persona_shared_memory_bindings` table. See run 4 handoff plan `.planning/handoffs/2026-04-08-heartbeat-feedback-shared-memories.md` Phase C for the rename + binding model.
- **Knowledge bases** (`knowledge_base` table) — vector store per persona
- **Genome** (`genome` table) — evolution lineage
- **Test suites** (`test_suites` table) — quality gates
- **Teams** (`persona_teams`, `persona_team_members`, `persona_team_connections`) — the hierarchical team graph. Teams have a `parent_team_id` for nesting, members have a role (`orchestrator`/`worker`/`reviewer`/`router`), and team connections are directed edges between personas (`source_persona_id` → `target_persona_id` with `connection_type`, `condition`, `label`) for hierarchy/dependency/routing relationships. **This is the org-chart primitive** — do NOT propose building one from scratch.
- **Review queues** (`persona_manual_reviews` + `review_messages`) — manual review items with title, description, severity (`info`/`warning`/`error`), context_data, reviewer_notes, status (`pending`/`resolved`/etc.). Review messages are the per-review conversation thread. Used by the `design-reviews` group.

### `review_decision.*` event payload (multi-use-case chaining)

The platform publishes `review_decision.approved` / `review_decision.rejected` from `src-tauri/src/commands/design/reviews.rs:878-919` with payload `{ review_id, execution_id, persona_id, title, decision, reviewer_notes, context_data }`. The `context_data` field carries the original review's structured payload (proposed diffs, blobs the surfacing persona wrote) so downstream use cases that subscribe to `review_decision.*` can act on the full proposal without an IPC fetch-back.

**History:** the `context_data` field was added on 2026-04-24 after a `/research` run (MiniMax-AI/skills) designed the Skill Librarian template and discovered the payload was missing it. Patch landed the same session; no backward-compat concerns (no external consumers of the event at the time).

**Recommendation for template authors:** chain off `review_decision.approved` and read `payload.context_data` directly. Keep a defensive `manual_review` fallback for the edge case where `context_data` is null (old events re-played, or the surfacing persona didn't populate it), but don't design around the IPC fetch-back as the primary path.

### Connector binding model — catalog vs runtime (CRITICAL distinction)

The 87 connectors in `scripts/connectors/builtin/` (and the 87 entries in `codebase-catalogs.md`) are a **discovery catalog**, not a runtime tool surface. Each persona instance **binds only 0-3 connectors** from the catalog to its execution context. The system prompt at runtime injects credentials only for those bound connectors (see `engine/prompt.rs:342-354` `## Available Credentials` section).

**Implications:**
- "Personas exposes 87 tools to every execution" is **wrong**. Each execution sees only the persona's bound connectors.
- "Tool surface minimization" critiques against the catalog size do NOT apply at runtime — they only apply at the *catalog browse / persona configuration* surface.
- When evaluating ideas about token cost, prompt size, or model freedom, the relevant denominator is **per-persona connector count (0-3)**, not catalog size.
- The `llm_usage_hint` field added in run 2's plan is injected only for connectors actually bound to the executing persona — its token cost is bounded by the persona's binding count, not the catalog size.

This distinction was missed in `/research` run 3 (2026-04-08, Codex/Bolin video), leading to a misframed "tool surface minimization" finding. User correction recorded as a permanent rule.

### Desktop bridges: typed wrappers for native CLIs (engine/desktop_bridges.rs)

Personas already supports calling native CLI binaries (vs. HTTP APIs) via typed
bridge modules in `src-tauri/src/engine/desktop_bridges.rs`. The canonical
example is the `vscode` module: a `VsCodeAction` enum (`OpenFile`, `OpenFolder`,
`DiffFiles`, `InstallExtension`, `RunTask`, ...) plus an `execute(binary, action)`
function that spawns the binary via `tokio::process::Command` and returns a
`BridgeActionResult`. New bridges follow the same shape and are gated by
`engine/desktop_security::DesktopConnectorManifest` for capability approval.

This is **distinct from** the HTTP-API connectors in `scripts/connectors/builtin/*.json`.
The 100 builtin connectors are HTTP-API wrappers; desktop bridges are *binary*
wrappers. When a `/research` finding is about wrapping a native CLI, the
attachment point is `desktop_bridges.rs`, NOT the connector catalog.

**Build-time codegen helper:** `scripts/generate-cli-bridge.mjs` (added 2026-04-12)
auto-generates a bridge stub by parsing `<binary> --help`. Output is
intentionally a stub — the human reviews enum variants, fills in the execute()
body, and registers the module. Works best on tools with structured `--help`
output (gh, kubectl, terraform, jq, docker); falls back to user-provided
subcommand list for tools that use man-page mode (git).

This was added after `/research` run on 2026-04-12 (GitHub Trending Weekly #30,
Clyjs finding) discovered the existing bridge layer was hand-coded.

### AI healing fix variants (engine/ai_healing.rs)

`HealingFix.fix_type` accepts these variants:
- `modify_prompt` — change persona system_prompt or structured_prompt section
- `update_config` — change timeout_ms (1000-1800000), max_turns (1-100), enabled (true only)
- `modify_file` — file edit performed by the CLI's own tool use (logged only)
- `run_command` — command run by the CLI's own tool use (logged only)

**Removed 2026-05-10:** `instrument_and_reproduce` (proposed log-point
injection + re-execution). The orchestrator that would actually inject log
points and trigger the re-run never shipped, and the healer kept proposing
the variant into a phantom `ai_heal_instrument_proposed` audit row that no
consumer acted on. Architect ADR
[[Architect/decisions/2026-05-10-instrument-and-reproduce-phantom]] applied
the cheap-path resolution: the healer prompt no longer advertises the
variant, the dispatch arm was removed (legacy healer output falls through
to the unknown-fix-type warn arm), and the parser is left intact so any
legacy emitter still parses without crashing. The original 2026-04-12
introduction (from a `/research` run on Debug Agent) is the prerequisite
context if anyone wants to re-introduce it together with a real
orchestrator.

This was added after `/research` run on 2026-04-12 (Debug Agent finding from
GitHub Trending Weekly #30). Future runs proposing additional healing fix types
should grep for `HealingFix.fix_type` matches and add a dispatch arm in
`apply_db_fixes` plus an entry in the healer prompt's "Database Fix Format"
section.

### Personas framework vs `dev-tools` plugin (architectural boundary)

Personas-the-framework is **general-purpose**: it orchestrates agents that work on email, documents, finance, content, and many other domains beyond coding. Code/SDLC-specific features should NOT live in the core engine.

The repo has a dedicated **`dev-tools` plugin** at `src/features/plugins/dev-tools/` (frontend) backed by `src-tauri/src/commands/infrastructure/dev_tools.rs` (~2060 lines) and `src-tauri/src/db/repos/dev_tools.rs` (~2210 lines). Sub-modules:

- `sub_context` — context map (the `dev_contexts` table that `/refresh-context` exports from)
- `sub_lifecycle` — software lifecycle / goal constellation
- `sub_projects` — project manager + GitHub repo selector + implementation log
- `sub_runner` — task runner + self-healing panel + task output
- `sub_scanner` — idea scanner + idea evolution. **Two parallel idea sources** as of 2026-04-30:
  - **LLM-driven** — `commands/infrastructure/idea_scanner.rs` spawns Claude CLI with scan-agent prompts (security-auditor, code-optimizer, etc.) loaded from `scan_agents.toml`. Slow, expensive, semantic, monthly-cadence-shape.
  - **Deterministic** — `commands/infrastructure/static_scan.rs` spawns a user-configured static-analysis CLI (Fallow / Knip / jscpd / etc.) per-project (config in `dev_projects.static_scan_config`), parses its JSON output via a permissive multi-shape parser, and writes findings as `DevIdea` records. Fast, free, zero-LLM, per-commit-cadence-shape.
  - **Both** write to the same `dev_ideas` table via `repo::create_idea`. Findings about the idea pipeline should route to whichever source matches the cadence/cost profile (or propose a third parallel source if the shape doesn't fit either). Added in `/research` run 2026-04-30 (Fallow walkthrough).
- `sub_triage` — idea triage + effort/risk filter + triage rules

DB tables owned by the plugin: `dev_projects`, `dev_context_groups`, `dev_contexts`, `dev_context_group_relationships`, `dev_ideas`, `dev_*` (others).

**Routing rule for `/research` findings:**
- Code-area features that apply to agents in general (sandbox, output discipline, prompt assembly, credential handling) → core engine
- Code-area features that apply specifically to software development workflows (worktree isolation, CLAUDE.md auto-update, repo scans, PR generation, build automation) → `dev-tools` plugin
- A user can always wire a generic persona to do code work via custom instructions — but the **framework** stays domain-agnostic; **plugin** features are where domain specialization lives

This rule was added after `/research` run 3 (2026-04-08), where findings [3] (worktree isolation) and [4] (CLAUDE.md auto-update) were initially misrouted to the core engine.

### Claude Code plugin walkthrough → GSD skill layer (routing rule)

When a `/research` source is a walkthrough of a **Claude Code plugin** (Superpowers, Compound Engineering, a2a-kit, Ultra Plan, etc.), default-route findings to the **GSD skill layer**, NOT the core engine. Personas wraps Claude Code as its LLM provider, but plugin-layer features (planning shapes, TDD-style workflows, adaptive question flows, compound-learnings stores, orchestration skills) overlap architecturally with the GSD skill suite (`/gsd-discuss-phase`, `/gsd-plan-phase`, `/gsd-add-tests`, `/gsd-autonomous`, `/gsd-review`, `--power` mode). The catch dominance on these sources is a load-bearing signal: most Claude Code plugin features are already implemented as GSD skills or as engine primitives with production callers.

**When to override:** the plugin exposes a new CLI flag, a new stream-JSON event type, a new prompt-delivery mechanism (stdin vs argv), or a new management-API protocol that personas' engine must track. In those cases the finding DOES belong in the engine (typically at `engine/prompt.rs::build_cli_args` — the 30-caller funnel — or `engine/provider/` for new provider shapes).

**Observations:**
- 2026-04-13 — Superpowers walkthrough (first)
- 2026-04-13 — a2a-kit tutorial (second)
- 2026-04-15 — Compound Engineering (Every Ink) walkthrough (third)
- 2026-04-16 — Ultra Plan vs Superpowers comparison (fourth — promotion threshold reached)

**Practical effect on Phase 6:** when the source matches this profile, run the host-first grep once across both the engine AND the GSD skill list (`.claude/skills/gsd-*`). A plugin feature that has no engine match but has a GSD skill match is a **catch**, not a finding. The source's value on these runs is usually the catch table (confirmation that personas already covers the competitor's surface), not new code.

---

## 4. Tech Stack

### Frontend
| Layer | Technology | Version |
|---|---|---|
| Runtime | Node | ≥20 |
| Framework | React | 19.2 |
| State | Zustand | 5.0 |
| Build | Vite | 8.0 |
| Lang | TypeScript | 6.0 |
| Styling | Tailwind CSS | 4.2 |
| Test | Vitest | 4.1 |
| E2E | Playwright | 1.59 |
| Charts | Recharts | 3.8 |
| DnD | @dnd-kit | 6.3 |
| Animation | Framer Motion | 12.38 |
| Markdown | react-markdown + remark-gfm + rehype-highlight | — |
| Graph viz | @xyflow/react | 12.10 |
| Icons | lucide-react | 1.7 |
| Telemetry | @sentry/react | 10.45 |
| Tauri bindings | @tauri-apps/api + plugins (deep-link, dialog, notification, shell, updater) | 2.x |

### Backend
| Layer | Technology | Version |
|---|---|---|
| Lang | Rust | 2021 edition |
| Async | Tokio | 1.x |
| Desktop shell | Tauri | 2.x |
| HTTP | reqwest (rustls-tls) | 0.12 |
| DB | rusqlite (bundled) | 0.38 |
| Pool | r2d2 | — |
| Crypto | aes-gcm + pbkdf2 | 0.10 |
| Serde | serde + serde_json + serde_yaml | 1.x |
| TS export | ts-rs | — |
| P2P | libp2p (mDNS, gossipsub) | — |
| Telemetry | sentry + tracing | 0.34 |
| Graph | petgraph (pipeline topology) | — |
| OCR | tesseract | — |

### CLI engines (spawned subprocesses)
- **claude** (or `claude.cmd` / `claude.exe` / `claude-code` on Windows) — primary, stdin prompt delivery
- **codex** — secondary, same provider trait shape

### Catalogs (filesystem)
- `scripts/templates/{category}/*.json` — 92 templates across 15 categories (see `codebase-catalogs.md`)
- `scripts/connectors/builtin/*.json` — 87 connectors (see `codebase-catalogs.md`)

---

## 5. Build & Dev Commands

```bash
# Frontend dev (Vite, no Tauri shell)
npm run dev

# Type check + lint
npm run check

# Unit tests
npm run test

# E2E CLI tests
npm run test:e2e:cli

# Production build
npm run build

# Tauri dev (full app with Rust backend)
npm run tauri dev

# Bundle budget check
npm run check:budget

# Security audit
npm run audit:security

# Backend type check — MUST pass --features desktop.
# Bare `cargo check` FAILS: Cargo.toml default=[] omits `desktop`, but a
# capability references `updater:default` which only compiles under that
# feature, so the tauri permission build-script errors with
# "Permission updater:default not found" (added to stack 2026-05-25 after it
# cost an /architect run two dead-end rebuilds). Mirrors the tauri:dev:lite profile.
cd src-tauri && cargo check --features desktop

# Tier-specific builds
npm run build:starter   # starter tier
npm run build:team      # team tier
npm run build:builder   # builder tier
```

---

## 6. Key Conventions

### State management
- **Frontend stores:** Zustand only. One store per concern (`personaStore`, `execStore`, `chatStore`, `pipelineStore`, etc. in `src/stores/`).
- **No Redux, no Context API for global state, no signals libraries.** Don't propose adding alternatives.
- **No SWR / React Query.** Data fetching goes through the `src/api/` layer which calls Tauri commands directly.

### State management: load-bearing patterns

`/architect` run 2026-05-09 (state-management theme) identified three call-site/slice-author invariants holding across 13 stores, ~50 slices, and ~1900 store consumption sites. Established by [[Architect/decisions/2026-05-09-codify-zustand-discipline]].

1. **Never `use[X]Store()` with no selector.** Whole-store subscriptions cause re-render on every state change across the entire store. Always pass a selector:
   - `useAgentStore((s) => s.personas)` — single field
   - `useAgentStore(useShallow((s) => ({ a: s.a, b: s.b })))` — multi-field
   - `useAgentStore.getState()` — outside React, in event handlers, or for one-shot reads
   - **Enforced by:** `eslint-rules/no-whole-store-subscription.cjs` (warn; 8 known violations as of 2026-05-09 in `i18n/useTranslation`, `EditorDocument`, `LanguageSwitcher`, `AppearanceStep`, `TranslationContributor` — opportunistic cleanup backlog).
2. **Every slice uses `StateCreator<Store, [], [], XxxSlice>` typing.** Factories are `(set, get) => ({...})` or `(set) => ({...})` with the StateCreator generic attached; never raw object literals or untyped factories.
3. **No slice-key collisions within a domain.** Each slice prefixes its keys with a domain marker (`buildPhase`, `chatMode`, `healthCheck*`, `budget*`, etc.) so `...createA(...a), ...createB(...a)` composition can't silently clobber. TS intersection types let later property win silently — collisions don't break the build.
   - **Enforced by:** `src/__tests__/structural/store-discipline.test.ts` (Vitest structural test that walks `src/stores/slices/**/*.ts` via `import.meta.glob` and asserts both invariants 2 and 3).

**Persist write-dedup.** Stores using `persist` middleware should wrap their storage in `createDedupedJSONStorage()` from `src/stores/util/dedupedStorage.ts`. Zustand re-runs partialize+setItem on every `set()`, so a 25-field partialize tree gets serialized + written on every navigation event regardless of whether the partialized fields moved. The dedup helper skips writes when the serialized payload is unchanged. Applied to `agentStore`, `systemStore`, `themeStore` as of 2026-05-09. Established by [[Architect/decisions/2026-05-09-systemstore-themestore-dedup]].

**`globalThis` for HMR-surviving singletons.** Use the `??=` assignment pattern (`globalThis.__personasFoo ??= initialValue`). Current singletons: `__personasEventBridge` (`src/lib/eventBridge.ts`), `__personasTourStorage*` (`src/stores/slices/system/tourSlice.ts`), `__executionBufferProbe__` (`src/stores/slices/agents/executionSlice.ts`, dev-only). Slice-scoped singletons could ideally consolidate to `src/lib/singletons/` but the scattered locations work in practice.

### IPC layer
- All Rust commands live under `src-tauri/src/commands/` grouped by domain (`core/`, `credentials/`, `design/`, `execution/`, `infrastructure/`, `tools/`, `network/`, `recipes/`, `obsidian_brain/`, `ocr/`, `artist/`, `communication/`).
- Frontend wrapper: `src/api/` mirrors the same grouping. Each `.ts` file calls `invoke('command_name', payload)`.
- Commands are name-generated by `scripts/generate-command-names.mjs` (runs in `predev` and `prebuild`).
- HMAC-token enforcement is **wrapper-level** (`ipc_auth::wrap_invoke_handler`) — runs before-dispatch on every command, NOT opt-in. Defense-in-depth via per-command `require_privileged_sync` / `require_privileged` calls. Allowlists: `PRIVILEGED_COMMANDS` (~117), `CLOUD_COMMANDS` (~54). Stampede detector + retry depth cap layered on top.
- **Policy: every IPC call must go through `src/api/<domain>/`** — never `invokeWithTimeout` directly from feature components / hooks / stores. Architect run 2026-05-10 (ipc-boundary scan finding 5) found 17 files with direct `invoke` usage and 182 backend commands without an api/ wrapper. Direct-invoke is the anti-pattern; wrap in api/ to keep the IPC contract centralized and type-safe at one seam. Exceptions worth knowing about:
  - `src/stores/authStore.ts` — auth login/logout uses direct invoke because it bootstraps before the api/ layer is fully wired. Treat as deliberate, not as precedent.
  - `src/test/automation/bridge.ts` — test harness that imports raw `invoke` from `@tauri-apps/api/core` to drive E2E flows. Test infra; not production code.
  - Anywhere else: route through api/ — established by [[Architect/decisions/2026-05-10-orphan-commands-wrap]].

### IPC layer: `invokeWithTimeout` 250ms in-flight auto-dedup (INVISIBLE strong pattern)

`src/lib/tauriInvoke.ts` maintains an in-flight Promise Map (`inflightAutoDedup`) keyed by `(command, JSON.stringify(args))` with a ~250ms TTL on read-only commands. When two callers fire the same command with identical args inside the window, the second caller receives the first caller's still-in-flight promise — only one IPC roundtrip hits the backend.

**Surfaced by /architect performance scan 2026-05-17 (sub-agent 2) as a "surprise" finding** — the mechanism is invisible from call sites and was previously undocumented anywhere. Concrete consequences:

- A persona-switch burst where 3-4 components mount and call `list_credentials()` in the same tick → 1 IPC, not 3-4.
- Higher-level slice caches (e.g. `executionSlice.executionsCache`, the 2026-05-17 credentialSlice TTL+inflight via `inflightCredentialsFetch`) layer on top of this for a 30s window beyond the 250ms.
- Differing args defeat dedup. The 2026-05-17 `useQuickStats` fix (standardize fetch limit to 50 to match ActivityTab) was specifically to align args so the auto-dedup window catches the pair.

**Risk to losing:** a well-intentioned "let me clean up this Map" refactor could tank cold-start IPC counts by 2-4× without any failing test or lint rule to catch it. Documented here so the seam stays load-bearing. Established by /architect scan 2026-05-17; preserved as a noted strong-pattern at [[Architect/strong-patterns#tauriInvoke 250ms in-flight auto-dedup]].

### Database
- Two SQLite files, both in `%APPDATA%/com.personas.desktop/`:
  - `personas.db` — operational data (personas, executions, triggers, credentials, etc.)
  - `personas_data.db` — user-facing data (vaults, knowledge bases) — separate pool
- Migrations: `src-tauri/src/db/migrations/` (split: `schema.rs` for the canonical CREATE TABLE bundle, `initial.rs` to apply it, `incremental.rs` for column/table additions, `fk_hygiene.rs` for FK retrofits). 100+ migrations as of 2026.
- Repository pattern: `src-tauri/src/db/repos/{group}/{entity}.rs` returns typed models from `src-tauri/src/db/models/`.
- Update hook registered to push DB changes through the event bus to the frontend.

### Schema FK convention (load-bearing)
- `PRAGMA foreign_keys = ON` is enforced globally on every connection (`db/mod.rs:83-86`). Every parent-child column pair MUST declare an explicit `REFERENCES parent(id) ON DELETE <CASCADE|SET NULL>` clause; the policy is not optional.
- **CASCADE** for owned children whose lifetime ends with the parent (memories, messages, healing_issues, metrics_snapshots, prompt_versions, message_deliveries, pipeline_runs).
- **SET NULL** for nullable references that should outlive their target (event recipients, optional handoff pointers).
- **No FK** only when the column is polymorphic (e.g., `persona_events.source_id` whose referent type depends on `source_type`). Document the polymorphism in a SQL comment next to the column so future scans don't flag it as an oversight.
- Adding a FK to an existing table requires the `recreate_with_fk` helper in `migrations/fk_hygiene.rs` — SQLite has no `ALTER TABLE ADD CONSTRAINT`. The helper handles idempotency, orphan cleanup, row-count assertion, and `pragma_foreign_key_check` verification.
- Established by [[Architect/decisions/2026-05-02-fk-hygiene-cascade]] (8 tables retrofitted, 5 manual cleanup lines collapsed).

### Error handling (load-bearing discipline — established 2026-05-10)

The codebase enforces a layered error-handling discipline. Established as a strong-pattern by `/architect` run 2026-05-10 (error-handling theme); see [[Architect/decisions/2026-05-10-codify-error-discipline-helpers]]. The four invariants that survive across `~1300+ Rust commands + ~150 frontend catch sites`:

1. **Rust commands return `Result<T, AppError>`.** `AppError` is the single error type for the IPC boundary; defined in `src-tauri/src/error.rs` (21 variants as of 2026-05-10, all Serialize-covered with PII-scrubbing on Database/Io/Internal). At time of codification, ~91% of `#[tauri::command]` functions comply (1293 sites); the remaining 9% (~134 commands across 54 files including `radio.rs`, `live_roadmap.rs`, `auto_cred_browser.rs`) return `Result<T, String>` and are tracked for migration in [[Architect/backlog]] under the error-handling theme. The 100%-compliance enforcement vehicle (a `[lints.clippy]` block + structural test asserting every `#[tauri::command]` returns `Result<_, AppError>`) ships when the migration backlog item lands.

2. **Frontend `.catch()` handlers wrap with `silentCatch()` or `toastCatch()`.** From `src/lib/silentCatch.ts`: `toastCatch()` records a Sentry breadcrumb + shows a toast for user-facing errors; `silentCatch()` records a Sentry breadcrumb + console-logs for background errors. `silentCatchNull()` is the variant that returns `null` on error (data-fetch fallback). At time of codification ~152 sites use a helper, ~58 raw `.catch((err) => ...)` sites bypass them. ESLint rule `custom/no-silent-catch` (warn) flags empty catches; the wider rule covering "raw catch without helper" is queued at [[Architect/backlog]] as a rule addition.

3. **User-facing error rendering goes through `resolveErrorTranslated()` from `src/i18n/useTranslatedError.ts`.** Backed by `ERROR_KEY_MAP` (34 patterns as of 2026-05-10) and `error_registry` keys in `src/i18n/locales/en.json`. Locale parity is 100% (CI gate `npm run check:error-registry` enforces ERROR_KEY_MAP ↔ en.json key existence; `npm run check:i18n` enforces locale-keyset parity). When `resolveErrorTranslated` (or `resolveError`) rewrites a raw error, both helpers record a Sentry breadcrumb (`category: 'error.resolved'`, `level: 'warning'`) with the raw error string + resolved keyPrefix BEFORE returning — so operators reviewing user-report tickets see the raw underlying error, not only the friendly rewrite. Established by [[Architect/decisions/2026-05-10-resolveerror-breadcrumb-spawn-tracing]].

4. **Rust-side errors that should reach Sentry use `tracing::error!()`.** The sentry_tracing layer in `src-tauri/src/logging.rs` captures `Level::ERROR` as a full Sentry event and `Level::WARN` as a breadcrumb. Disk-only `logger.log("[ERROR] ...")` calls bypass Sentry — they are correct as a per-execution local trace (kept alongside `tracing::error!`), not as the sole observability surface. The canonical example is `engine/runner/mod.rs` spawn-failure path, which calls both: `tracing::error!` for production observability + `logger.log` for the local execution trace.

**Why this matters:** Sentry breadcrumb coverage is a function of helper adoption; structured IPC error metadata is a function of `Result<T, AppError>`; operator-debugging quality is a function of the raw-before-rewrite breadcrumb. The four invariants together ensure that an error visible in a user report has a fully-correlated trace from the raw Rust origin through to the friendly user copy.

**Risk to losing:** if helper adoption drifts below ~80% or Rust commands start returning `Result<T, String>` again, Sentry breadcrumb coverage gets patchy and operators lose the ability to correlate user reports with backend logs. The CI gate from invariant 3 + the queued `[lints.clippy]` + the queued lint-rule for invariant 2 are the planned mechanical defenses; until those ship, the discipline is held by social convention + this docs-stack section + per-PR review.

### Plugins
- The app has a plugin architecture under `src/features/plugins/` (dev-tools, gitlab, etc.).
- Plugins surface via the sidebar; each owns its own routes, store slice, and IPC commands.

### Templates as first-class artifacts
- Templates are git-tracked JSON in `scripts/templates/`. The catalog is verified by `scripts/generate-template-checksums.mjs` at build time.
- Templates can be authored manually or via `/add-template` skill.
- The Supabase `template_catalog` table mirrors the local files for the public catalog (publication is part of `/add-template` Phase 5).

### Connectors
- Builtin connectors live in `scripts/connectors/builtin/*.json`.
- Each connector also has a Rust seed entry in `src-tauri/src/db/mod.rs::seed_builtin_connectors`.
- SVG icon in `public/icons/connectors/{name}.svg` with `fill="currentColor"` for theme support.
- OAuth providers also need a `PROVIDER_REGISTRY` entry in `src-tauri/src/commands/credentials/oauth.rs`.

### Memory layers (don't confuse them)
- **Agent memory** — `memories` table, episodic facts the *agent* learned during executions. Per-persona. Used by personas at runtime.
- **Persona memory store** — frontend Zustand store mirroring the above for UI display.
- **Companion brain** — Athena's personal memory. Lives at `src-tauri/src/companion/brain/` (17 files, 5-tier cognitive memory model: working/episodic/semantic/procedural/identity + relations graph + provenance). Submodules: `consolidation` (token-cap pruning + fuzzy dedup + per-item review with apply/reject), `reflection` (prose journaling, NOT in retrieval), `recall_synthesis` (synthesis at retrieval, shipped 2026-05-09), `doctrine`, `episodic`, `procedural`, `semantic`, `rituals`, `goals`, `identity`, `dashboard`, `retrieval`, `embeddings`, `graph`, `backlog`. The `mod.rs` doc-comment is the canonical 5-tier-model overview. Companion-only, separate user_db pool. Documented from /research run 2026-05-10 (Claude Managed Agents dreaming).
- **Obsidian vault** (`C:/Users/kazda/Documents/Obsidian/personas` on this machine; path is user-specific and should be treated as a variable in docs) — *user* memory for the `/research` skill, NOT exposed to runtime personas. Documented in `obsidian-integration` context group of `codebase-context.md`. Note: older copies of `skill.md` reference a stale `mkdol` username for the same path — that is a skill-file bug, not a codebase fact. Cleanup tracked separately.

### Background-job frameworks (companion + user-personas, parallel implementations)

Personas runs two **structurally-identical background-job frameworks** — one per DB pool — for async curation work that must not block the IPC caller:

| Surface | Module | Table | Event channel | Worker spawn |
|---|---|---|---|---|
| Companion (Athena) | `src-tauri/src/companion/jobs/{mod,curation_run,scan_codebase,connector_use}.rs` | `companion_background_job` (user_db) | `companion://job` | `companion_init` Tauri command (3s tick) |
| User-personas | `src-tauri/src/engine/persona_jobs.rs` (single-file, 685 LOC) | `persona_background_job` (db) | `persona://job` | `lib.rs` setup callback (5s tick, 3s startup delay) |

Lifecycle (both): `queued → running → completed | failed | canceled`. Both expose `enqueue / get / list / request_cancel / recover_orphans`. Both dispatch by `kind` string (companion: scan_codebase, connector_use, memory_curation_run; user-personas: memory_curation_run). Both append/emit on completion (companion appends a system episode for Athena's next turn; user-personas just emits the event).

**The user-persona side is intentionally a parallel implementation rather than a generic shared abstraction** — different DB pools, different UIs, different consumers. A future architect pass can DRY them up if divergence stays small. Adding a new job kind on either side is "match arm + sibling module" — no scaffolding needed.

`engine/scheduler.rs` (cron / trigger scheduler) is unrelated to these frameworks — it fires persona executions on schedule via the `triggers` table; it does NOT schedule background jobs. For scheduled curation, see `engine/curation_scheduler.rs` (added 2026-05-10).

Documented from /research run 2026-05-10 (Claude Managed Agents dreaming + follow-ups).

### `engine/dream_replay.rs` is execution-trace replay, NOT memory curation

`src-tauri/src/engine/dream_replay.rs` is a deterministic VCR-style replay engine that reconstructs execution state frame-by-frame from stored trace spans, **without consuming LLM tokens**. Each `DreamFrame` carries the active spans, completed spans, cumulative cost/tokens, depth, and error state at a specific millisecond boundary. Used for time-travel debugging of past executions.

**Distinct concept from Anthropic Managed Agents' "dreaming" memory pipeline.** The metaphor name is the same; the contract is different. Memory curation (Anthropic's dreaming) reads memory + sessions and produces a curated output store; trace replay reads execution spans and produces frame snapshots for UI scrubbing.

**Naming constraint for new modules:** avoid bare `dream` to prevent the cognitive collision. Memory curation work lives under `companion::brain::consolidation`, `companion::jobs::curation_run`, `engine::persona_jobs::memory_curation_run`, `engine::curation_scheduler` — never `dream_*`.

Discovered as a Phase 6 namespace clash during /research run 2026-05-10 (Claude Managed Agents dreaming).

### Testing
- Unit tests live alongside source as `#[cfg(test)] mod tests` (Rust) or `*.test.ts` (TS).
- E2E (vitest layer) uses Playwright via `vitest.e2e.config.ts` for cli-stream contract tests.
- **Live-app e2e** is a separate, custom 3-layer framework — see below.

### Test automation: 3-layer pattern (load-bearing — codified 2026-05-10)

Live-app e2e tests drive the running Tauri app through three coordinated layers. **Every new test affordance MUST flow through all three** — bypassing via `eval_js` is the failure mode this pattern prevents.

```
                   ┌─────────────────────────┐
   Python script ──▶│ MCP tool                │  tools/test-mcp/server.py
   (e2e_*.py)       │   28 tools mapping 1:1   │  (uvx-runnable)
                   │   to HTTP routes        │
                   └────────────┬────────────┘
                                │ HTTP
                                ▼
                   ┌─────────────────────────┐
                   │ Rust HTTP server         │  src-tauri/src/test_automation.rs
                   │   38 routes on :17320   │  (axum, feature-gated `test-automation`)
                   │   ↓ WebView eval()      │
                   └────────────┬────────────┘
                                │ JS eval
                                ▼
                   ┌─────────────────────────┐
                   │ JS bridge                │  src/test/automation/bridge.ts
                   │   ~60 macros on         │  (loaded only in dev mode)
                   │   window.__TEST__       │
                   └─────────────────────────┘
```

**Rule when adding a test affordance:**

1. Add a method to the JS bridge (`src/test/automation/bridge.ts`) — declare it on the `TestBridge` interface and implement on the bridge object.
2. Add an HTTP route in `src-tauri/src/test_automation.rs` that calls `eval_bridge_method(&state, "yourMethod", &params)` and register it in the `Router::new()` block.
3. Add an MCP tool in `tools/test-mcp/server.py` exposing the route.
4. Use it from a `tools/test-mcp/e2e_*.py` script. New scripts import shared helpers from `tools/test-mcp/lib/` (Client, Bridge, DB, wait_until, EventLog, snapshot) — do not copy-paste the legacy inline helpers.

**Anti-pattern (avoid):** adding a bridge method without HTTP/MCP counterparts and reaching it via `bridge.exec("yourMethod", {})` over `/bridge-exec`. That works mechanically (the dispatcher exists) but erodes the layered model — within a few iterations every method becomes a one-off `eval_js` call. Eleven such orphan macros existed before 2026-05-10; track follow-up cleanup in [[Architect/backlog#orphan-bridge-macros]].

### Test automation: build-from-intent canonical scenario (load-bearing — codified 2026-05-10)

Building a test persona always follows this sequence. 13+ scripts already use it; new persona-building scripts MUST mirror this shape:

```
1. startBuildFromIntent({ intent, timeoutMs })       → returns { sessionId, personaId }
2. loop:
     waitForBuildPhase({ phases: [awaiting_input, draft_ready, …] })
     listPendingBuildQuestions() → questions[]
     answerPendingBuildQuestions({ answers: { cellKey: text, … } })
   until phase ∈ {draft_ready, test_complete, promoted}
3. triggerBuildTest()         → runs the draft against its scenario
4. promoteBuildDraft()        → moves persona to `promoted` status
5. executePersona({ id })     → fires a real execution
```

**Why it works:** answers are keyed by stable `cellKey` (e.g. `"behavior_core"`, `"connectors"`), not by question text — so LLM rewrites of the question phrasing don't break tests. The cellKey contract is the load-bearing thing; preserve it when refactoring `engine/build_session/`.

**Canonical reference:** `tools/test-mcp/e2e_build_from_scratch.py`. New scripts should import the shared helpers from `tools/test-mcp/lib/` rather than reinventing the boilerplate; before 2026-05-10 ~1,360 LOC of duplicated post/bridge/db/poll helpers existed across 34 scripts.

**Anti-pattern (avoid):** hardcoding answer dicts inline in each script (the Phase A-K scripts inherited this from before the lib existed). Extract scenario-specific recipes into a shared registry only when the same recipe is used in 3+ scripts; meanwhile the inline dict is fine for single-purpose scripts.

### Frontend conventions
- **All UI conventions live in `.claude/CLAUDE.md` → "Important Conventions"** (auto-loaded into every conversation in this repo). Read that section before producing handoff plans that touch frontend code.
- Highlights worth surfacing to `/research`-style triage:
  - **Typography contrast (the muted-text antipattern):** body text — descriptions, dates, URLs, source paths — MUST use `text-foreground` (theme-aware white/black). Mute is reserved for structural micro-labels and badges. Visual hierarchy comes from `text-primary` + a subtle `[text-shadow:...color-mix(...)]` glow on titles, never from opacity. Enforced by `eslint-rules/no-low-contrast-text-classes.cjs`.
  - **Internationalization is non-negotiable:** every user-facing string lives in `src/features/{feature}/i18n/{lang}.ts` (or a per-submodule i18n folder). 14 supported languages. Never hardcode English in JSX/TS/JSON. When adding a key, update ALL 14 locale files in lock-step (use English placeholders + `// TODO(i18n-XX)` markers for the unsynced ones). The `useXxxTranslation()` hooks do direct property access, so any missing key crashes the UI at runtime.
  - **User-facing copy voice:** lead with impact, one idea per item, no file paths or implementation jargon. Release notes are news, not engineering logs. (Full rationale in CLAUDE.md → "UI Conventions → Internationalization → Voice for user-facing copy".)
  - **Semantic tokens over raw classes:** spacing (`CARD_PADDING`, `SECTION_GAP`, ...), type sizes (`typo-heading`, `typo-body`, ...), border radii (`rounded-card`, `rounded-modal`, ...), and shadows all have semantic tokens enforced by their own custom eslint rules.
  - **Modals always use `BaseModal`** from `@/lib/ui/BaseModal` (focus trap + ESC + backdrop dismiss handled centrally).
- **For `/research` runs producing UI handoffs:** include a one-line "Honor `.claude/CLAUDE.md` UI Conventions (typography contrast + i18n)" reminder in the handoff plan's "Cross-cutting concerns" section so the implementing CLI does not have to discover the rules by trial-and-error.

---

## 7. Things Not in This File (look elsewhere)

- **Where specific code lives** → `codebase-context.md` (DB-derived feature map)
- **What templates and credentials already exist** → `codebase-catalogs.md`
- **Recent commits / who changed what** → `git log` / `git blame`
- **Per-feature implementation details** → read source under the `file_paths` listed in `codebase-context.md`
