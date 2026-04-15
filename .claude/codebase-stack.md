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

**This is the single most important fact about personas:** the application does not implement an LLM client. It shells out to the `claude` binary on the user's `PATH` (or `claude-code` / `claude.exe` / `claude.cmd` on Windows) and treats it as the LLM provider. Codex CLI is the secondary provider with the same shape.

### Provider abstraction

Defined in `src-tauri/src/engine/provider/mod.rs` as the `CliProvider` trait. Two concrete impls:
- `src-tauri/src/engine/provider/claude.rs` — `ClaudeProvider`, engine name `"Claude Code CLI"`, context file `CLAUDE.md`
- `src-tauri/src/engine/provider/codex.rs` — `CodexProvider`, engine name `"Codex CLI"`, context file `AGENTS.md`

`CliProvider` exposes:
- `binary_candidates()` — names to search PATH for
- `prompt_delivery()` — `Stdin` (claude) or `Argv` — how the prompt reaches the binary
- `build_execution_args(persona, model_profile)` → `CliArgs` — flag list per execution
- `build_resume_args(session_id)` → `CliArgs` — `--resume <id>` form
- `parse_stream_line(line)` → typed stream events (system_init, message, result, tool_use, etc.)
- `apply_provider_env(args, profile)` — env vars to inject (e.g., model overrides)

### How a persona execution actually runs

1. `engine/runner.rs::run_persona` receives an execution request
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

`engine/provider/codex.rs::build_execution_args` does NOT call into `prompt::build_cli_args` — it builds Codex args independently, so Claude-specific flags like `--effort` don't apply to Codex. When proposing CLI flag changes, verify the flag is Claude-specific before adding it here.

### `assemble_prompt` brackets the persona content with TWO autonomy directives (top + bottom)

Discovered in `/research` run 12 (2026-04-12, Andrej Karpathy skills video). `engine/prompt.rs::assemble_prompt` prepends `EXECUTION_MODE_DIRECTIVE` at line 95 (constant at line 1462) **and** appends a second "EXECUTE NOW" reinforcement at line 497-511 which repeats the "Act autonomously — do NOT ask questions" instruction. Persona-authored `structured_prompt.customSections` (line 252) land **between** the two directives, so a template cannot override "don't ask questions" via customSections alone — any such override would be contradicted at the bottom of the prompt by the EXECUTE NOW block.

**Implication for /research:** any finding that proposes changing default prompt behavior (discipline mode, clarification style, verification rituals, early-exit rules) must touch BOTH sites (line 95 + line 497-511), or it only half-works. This is the "pre + post sandwich" pattern — assume it applies until verified otherwise. See the Karpathy discipline handoff at `.planning/handoffs/2026-04-12-karpathy-discipline-override.md` for the reference implementation of a dual-site directive override.

### Effort flag mechanism (CLI 2.1.94 hardening)

`engine/prompt.rs::DEFAULT_EFFORT = "medium"` is the personas-pinned default effort level. CLI 2.1.94 silently changed the implicit CLI default from `medium` to `high` for API-key/Bedrock/Vertex/Foundry/Team/Enterprise users; personas pins `medium` everywhere via `--effort` so behavior is deterministic across CLI versions and account tiers. Override path:
- `ModelProfile.effort: Option<String>` (`engine/types.rs:285`) — when set, replaces the default
- Lab path: `TestModelConfig.effort: Option<String>` (`engine/test_runner.rs:58`) is plumbed through to the constructed `ModelProfile` in `execute_scenario`
- Frontend: `src/lib/models/modelCatalog.ts::selectedModelsAndEffortsToConfigs(models, efforts)` produces a cartesian product (model × effort) that the lab panels use to vary effort alongside model. `DEFAULT_EFFORT = 'medium'` and `EFFORT_LEVELS = ['low', 'medium', 'high']`.
- Persona-level overrides should reuse the existing `parameters: Option<String>` JSON column via a `PersonaParameter` of type `select` — NOT a new schema column (per the runtime-knob rule).

### Implications for /research

When an idea touches **any** Claude Code CLI feature, it's almost certainly relevant:
- Hooks (PreToolUse/PostToolUse/Stop/etc.) → personas could surface them as persona-level event subscriptions
- Slash commands → potentially compilable into persona use cases
- MCP servers → already integrated via `mcp_server/` module — ideas about MCP are direct hits
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
- `instrument_and_reproduce` — *deferred fix*: propose log points to inject and
  request a re-execution. Used when the healer doesn't have enough evidence to
  write a confident fix. Recorded in `healing_audit_log` with subsystem
  `ai_heal_instrument_proposed`. As of 2026-04-12 the actual injection and
  re-execution orchestration is NOT implemented — the v1 records the proposal
  so the AI healer can start producing reproduce-and-verify suggestions on real
  failures, generating data for the future orchestrator design.

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
- `sub_scanner` — idea scanner + idea evolution
- `sub_triage` — idea triage + effort/risk filter + triage rules

DB tables owned by the plugin: `dev_projects`, `dev_context_groups`, `dev_contexts`, `dev_context_group_relationships`, `dev_ideas`, `dev_*` (others).

**Routing rule for `/research` findings:**
- Code-area features that apply to agents in general (sandbox, output discipline, prompt assembly, credential handling) → core engine
- Code-area features that apply specifically to software development workflows (worktree isolation, CLAUDE.md auto-update, repo scans, PR generation, build automation) → `dev-tools` plugin
- A user can always wire a generic persona to do code work via custom instructions — but the **framework** stays domain-agnostic; **plugin** features are where domain specialization lives

This rule was added after `/research` run 3 (2026-04-08), where findings [3] (worktree isolation) and [4] (CLAUDE.md auto-update) were initially misrouted to the core engine.

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

# Backend type check
cd src-tauri && cargo check

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

### IPC layer
- All Rust commands live under `src-tauri/src/commands/` grouped by domain (`core/`, `credentials/`, `design/`, `execution/`, `infrastructure/`, `tools/`, `network/`, `recipes/`, `obsidian_brain/`, `ocr/`, `artist/`, `communication/`).
- Frontend wrapper: `src/api/` mirrors the same grouping. Each `.ts` file calls `invoke('command_name', payload)`.
- Commands are name-generated by `scripts/generate-command-names.mjs` (runs in `predev` and `prebuild`).
- All commands require IPC auth token (`src-tauri/src/ipc_auth.rs`) — stampede detector + retry depth cap added Q1 2026.

### Database
- Two SQLite files, both in `%APPDATA%/com.personas.desktop/`:
  - `personas.db` — operational data (personas, executions, triggers, credentials, etc.)
  - `personas_data.db` — user-facing data (vaults, knowledge bases) — separate pool
- Migrations: `src-tauri/src/db/migrations.rs` (single file, IF NOT EXISTS pattern). 100+ migrations as of 2026.
- Repository pattern: `src-tauri/src/db/repos/{group}/{entity}.rs` returns typed models from `src-tauri/src/db/models/`.
- Update hook registered to push DB changes through the event bus to the frontend.

### Error handling
- `AppError` enum in `src-tauri/src/error.rs` — all command results return `Result<T, AppError>`.
- Frontend treats commands as throwable; catches in API layer.
- Sentry telemetry on both sides.

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
- **Obsidian vault** (`C:/Users/kazda/Documents/Obsidian/personas` on this machine; path is user-specific and should be treated as a variable in docs) — *user* memory for the `/research` skill, NOT exposed to runtime personas. Documented in `obsidian-integration` context group of `codebase-context.md`. Note: older copies of `skill.md` reference a stale `mkdol` username for the same path — that is a skill-file bug, not a codebase fact. Cleanup tracked separately.

### Testing
- Unit tests live alongside source as `#[cfg(test)] mod tests` (Rust) or `*.test.ts` (TS).
- E2E uses Playwright via `vitest.e2e.config.ts`.
- Custom MCP-driven test automation framework also exists for Tauri IPC testing (~126ms/op, see memory `project_test_automation_framework`).

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
