# PERSONA.md

Canonical definition of a **Persona** in the Personas Desktop system. This document is the authoritative reference for what a Persona is, what it contains, how it behaves, and how it relates to every other entity in the system.

---

## What is a Persona?

A Persona is a **configurable, autonomous AI agent** with a defined identity, operational instructions, assigned tools, activation triggers, and runtime constraints. It is the central entity in the system — nearly every other table, engine module, and UI feature exists to configure, execute, observe, or govern a Persona.

A Persona is **declarative**: you define *what* it should do (prompt, tools, constraints) and the system handles *how* (scheduling, execution, error recovery, observability). Each execution is stateless and independent — the Persona's prompt and configuration are assembled fresh for every run.

---

## Core Data Model

```
Persona
├── id                  : String (UUID)
├── project_id          : String (namespace, default "default")
├── name                : String
├── description         : Option<String>
├── system_prompt       : String            ← simple identity text (fallback)
├── structured_prompt   : Option<String>    ← JSON with rich sections (primary)
├── icon                : Option<String>    ← icon name for UI
├── color               : Option<String>    ← hex color for UI
├── enabled             : bool
├── max_concurrent      : i32 (default 1)   ← parallel execution cap
├── timeout_ms          : i32 (default 300000) ← per-execution timeout
├── notification_channels: Option<String>   ← JSON notification config
├── last_design_result  : Option<String>    ← cached DesignAnalysisResult JSON
├── model_profile       : Option<String>    ← JSON model/provider override
├── max_budget_usd      : Option<f64>       ← cost cap per execution
├── max_turns           : Option<i32>       ← conversation turn limit
├── design_context      : Option<String>    ← files/references used in design
├── group_id            : Option<String>    ← FK to PersonaGroup
├── created_at          : String (RFC3339)
└── updated_at          : String (RFC3339)
```

Source: `src-tauri/src/db/models/persona.rs`

---

## Prompt Architecture

A Persona has a **two-tier prompt system**. When both exist, `structured_prompt` takes precedence and `system_prompt` is ignored.

### system_prompt (simple mode)

A plain text string describing the agent's identity and role. Used as a fallback when no structured prompt exists.

### structured_prompt (rich mode)

A JSON object with six sections that are assembled into the final execution prompt by `src-tauri/src/engine/prompt.rs`:

```json
{
  "identity":       "Who this persona is and its core purpose",
  "instructions":   "Step-by-step operational instructions",
  "toolGuidance":   "How and when to use each assigned tool",
  "examples":       "Example interactions or scenarios",
  "errorHandling":  "How to handle errors and edge cases",
  "customSections": [
    { "key": "section_key", "label": "Section Label", "content": "..." }
  ]
}
```

This structure is produced by the **Design Engine** (`src-tauri/src/engine/design.rs`) when Claude analyzes a user's natural-language instruction and generates a complete agent configuration.

### Prompt Assembly at Execution Time

The full prompt sent to Claude CLI is assembled by `prompt::assemble_prompt()` in this order:

1. `# Persona: {name}` header
2. `## Description` (if present)
3. `## Identity` / `## Instructions` / `## Tool Guidance` / `## Examples` / `## Error Handling` / custom sections (from structured_prompt, or system_prompt as identity fallback)
4. `## Available Tools` — documentation for each assigned tool
5. `## Available Credentials` — env var hints for decrypted credentials
6. `## Communication Protocols` — the six protocol instructions (see below)
7. `## Input Data` — JSON input for this execution (if any)
8. `## EXECUTE NOW` — final directive to begin work

### Prompt Versioning

Every prompt change is tracked in `PersonaPromptVersion` with a version number, the old prompt content, and a change summary. This enables diff-based prompt history.

---

## Model Configuration

A Persona can override the global model and provider via `model_profile` (JSON):

```json
{
  "model":      "claude-sonnet-4-20250514",
  "provider":   "anthropic | ollama | litellm | custom",
  "base_url":   "https://...",
  "auth_token": "sk-..."
}
```

The runner resolves provider settings at execution time:
- **anthropic** (default): No special env needed.
- **ollama**: Sets `OLLAMA_BASE_URL` and `OLLAMA_API_KEY`. Falls back to global `ollama_api_key` setting.
- **litellm**: Sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`. Falls back to global settings.
- **custom**: Sets `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

Source: `src-tauri/src/engine/prompt.rs` (`build_cli_args`)

---

## Entity Relationships

```
                         ┌─────────────┐
                         │PersonaGroup │
                         │  (folder)   │
                         └──────┬──────┘
                                │ group_id
                    ┌───────────┴───────────┐
                    │       PERSONA         │
                    └───┬───┬───┬───┬───┬───┘
                        │   │   │   │   │
          ┌─────────────┤   │   │   │   ├─────────────┐
          │             │   │   │   │                  │
    ┌─────┴─────┐ ┌─────┴───┐ │ ┌──┴──────┐    ┌──────┴───────┐
    │  Tools    │ │Triggers │ │ │Memories │    │  Events /    │
    │(assigned) │ │(activate│ │ │(learned │    │ Subscriptions│
    └─────┬─────┘ │ agent)  │ │ │knowledge│    └──────────────┘
          │       └─────────┘ │ └─────────┘
    ┌─────┴──────┐            │
    │ Tool       │     ┌──────┴──────┐
    │ Definitions│     │ Executions  │──── Execution Log
    │ (catalog)  │     │ (run history│──── Tool Steps
    └────────────┘     │  + metrics) │──── Execution Flows
                       └──────┬──────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐  ┌─────┴─────┐  ┌──────┴──────┐
        │ Messages  │  │  Manual   │  │  Healing    │
        │ (to user) │  │  Reviews  │  │  Issues     │
        └───────────┘  │(human gate│  │(auto-diag.) │
                       └───────────┘  └─────────────┘

    Credentials ──(via Connectors)──▶ injected as env vars at execution time
    Teams ──(via TeamMember)──▶ multi-persona pipeline orchestration
```

### Tools

A Persona has **zero or more tools** (many-to-many via `PersonaTool`). Each tool is a `PersonaToolDefinition` in a global catalog:

| Field | Description |
|-------|-------------|
| `name` | Tool identifier (e.g., `http_request`, `gmail_read`) |
| `category` | Grouping: `network`, `email`, `filesystem` |
| `script_path` | Executable path (e.g., `builtin://http_request`) |
| `input_schema` | Optional JSON schema for tool input |
| `requires_credential_type` | Credential type needed (e.g., `gmail`) |
| `is_builtin` | Whether it ships with the app |

7 builtin tools are seeded at startup: `http_request`, `gmail_read`, `gmail_send`, `gmail_search`, `gmail_mark_read`, `file_read`, `file_write`.

At execution time, tool documentation is injected into the prompt. Claude decides which tools to use. Tool calls are captured as `ToolCallStep` objects in `tool_steps`.

### Triggers

A Persona has **zero or more triggers** that determine when it activates:

| Type | Config | Scheduling |
|------|--------|------------|
| `manual` | `{}` | User clicks "Run" in UI |
| `schedule` | `{"cron": "0 9 * * 1-5"}` | Cron expression, computed by scheduler |
| `polling` | `{"interval_seconds": 300}` | Adds interval to `now` |
| `webhook` | URL/config | External HTTP POST |

The scheduler (`src-tauri/src/engine/scheduler.rs`) computes `next_trigger_at` and the background loop (`src-tauri/src/engine/background.rs`) checks for due triggers and queues executions.

### Credentials

Personas access external services through the **Credential → Connector** system:

1. **ConnectorDefinition**: Template for a service (e.g., Google Workspace). Defines required fields, healthcheck config, associated tool names.
2. **PersonaCredential**: An instance with encrypted data (`AES-256-GCM`). The `service_type` links it to a connector.
3. **At execution time**: The runner resolves credentials via a 3-tier fallback strategy:
   - **Primary**: Match tool names against connector `services[].toolName` arrays
   - **Fallback 1**: Match tool `requires_credential_type` against connector names (fuzzy prefix match)
   - **Fallback 2**: Query credentials directly by `service_type` matching the tool's `requires_credential_type`

   Matched credentials are decrypted and injected as environment variables: `{CONNECTOR_NAME}_{FIELD_KEY}`.

Credentials are never passed as CLI arguments and never written to logs.

### Memories

A Persona can store persistent knowledge via `PersonaMemory`:

| Field | Description |
|-------|-------------|
| `title` | Short label |
| `content` | Detailed content |
| `category` | `fact`, `preference`, `instruction`, `context`, `learned` |
| `importance` | 1–10 priority rating |
| `source_execution_id` | Which execution created it |
| `tags` | JSON array of string tags |

Memories are created mid-execution via the Agent Memory protocol. The memory system is designed to be **active** (consulted before decisions) and **progressive** (each execution builds on prior knowledge):
- **Before acting**: The persona's prompt instructs it to check memories for relevant past experience
- **After acting**: Store business outcomes, patterns, and optimizations discovered
- **Over time**: Build domain expertise through accumulated business knowledge

### Groups

Personas can be organized into **folders** (`PersonaGroup`) with name, color, sort order, and collapsed state. A persona's `group_id` references its group.

---

## Execution Lifecycle

### States

```
queued → running → completed | failed | cancelled
```

### Execution Flow

1. **Queue**: A trigger fires or the user clicks Run. An execution record is created with status `queued`.
2. **Prepare**: The runner loads the persona, its tools, and decrypts credentials. The prompt is assembled.
3. **Spawn**: Claude CLI is launched as a child process with the prompt piped to stdin. CLI flags include `--output-format stream-json`, `--verbose` (required by `--print` mode), `--dangerously-skip-permissions`, and optional `--model`, `--max-budget-usd`, `--max-turns`. Non-JSON verbose lines are filtered out by the parser to prevent duplicate display. The working directory is a stable per-persona path (`{temp}/personas-workspace/{persona_id}`) that persists across executions, allowing Claude Code's memory system and workspace files to carry over between runs.
4. **Stream**: stdout is read line by line. Each line is parsed for:
   - `AssistantText`: Natural language output
   - `AssistantToolUse`: Tool call with name and input
   - `ToolResult`: Tool output
   - `Result` lines: Token counts, cost, session ID, model used
   - Protocol messages (see below)
5. **Timeout**: If the process exceeds `timeout_ms`, it is killed.
6. **Complete**: Exit code 0 → `completed`, non-zero → `failed`. If exit code is 0 but the agent's `outcome_assessment` indicates the task was not accomplished, status is set to `incomplete`. If no `outcome_assessment` is found, a heuristic checks for error indicators in the output — if errors are present without success indicators, status is also `incomplete`. Execution record is updated with output, metrics, tool steps, and execution flows.
7. **Post-mortem**: Tool usage is recorded. Execution flows are extracted. If failed, the healing engine diagnoses the error.

### Execution Record (`PersonaExecution`)

| Field | Description |
|-------|-------------|
| `input_data` | JSON input provided to the persona |
| `output_data` | Final result text |
| `status` | `queued`, `running`, `completed`, `incomplete`, `failed`, `cancelled` |
| `input_tokens` / `output_tokens` | Token usage |
| `cost_usd` | Computed execution cost |
| `duration_ms` | Wall-clock time |
| `tool_steps` | JSON array of `ToolCallStep` objects |
| `execution_flows` | Extracted flow visualization data |
| `model_used` | Which model actually ran |
| `claude_session_id` | Claude session identifier |
| `log_file_path` | Path to full execution log file |

Source: `src-tauri/src/engine/runner.rs`

---

## Communication Protocols

During execution, a Persona can emit **structured protocol messages** by outputting JSON objects inline. These are parsed from the assistant's text output in real-time and written to the database mid-stream.

### 1. User Message

Send a notification to the user. Creates a `PersonaMessage` record and triggers desktop/channel notifications.

```json
{"user_message": {"title": "...", "content": "...", "content_type": "info", "priority": "normal"}}
```

### 2. Persona Action

Trigger another persona. Publishes a `persona_action` event to the event bus.

```json
{"persona_action": {"target": "persona-id", "action": "run", "input": {...}}}
```

### 3. Emit Event

Publish a custom event to the system event bus.

```json
{"emit_event": {"type": "task_completed", "data": {...}}}
```

### 4. Agent Memory

Store a persistent memory for future reference.

```json
{"agent_memory": {"title": "...", "content": "...", "category": "learning", "importance": 5, "tags": ["..."]}}
```

### 5. Manual Review

Flag something for human review. Creates a `PersonaManualReview` record with approve/reject workflow.

```json
{"manual_review": {"title": "...", "description": "...", "severity": "medium", "suggested_actions": ["..."]}}
```

### 6. Execution Flow

Declare execution flow metadata for visualization.

```json
{"execution_flow": {"flows": [{"step": 1, "action": "analyze", "status": "completed"}]}}
```

Source: `src-tauri/src/engine/prompt.rs` (protocol constants), `src-tauri/src/engine/runner.rs` (`handle_protocol_message`)

---

## Event System

Personas participate in a publish/subscribe event bus:

- **Publishing**: Personas emit events via the Emit Event and Persona Action protocols. System events (`execution_completed`, `execution_failed`) are also published automatically.
- **Subscribing**: `PersonaEventSubscription` links a persona to an event type with optional source filter (supports wildcard patterns). When a matching event arrives, the subscriber persona is executed with the event payload as input.

Event types: `execution_completed`, `execution_failed`, `manual_review`, `user_message`, `persona_action`, `emit_event`, `custom`.

Source types: `persona`, `user`, `system`, `scheduler`.

Source: `src-tauri/src/engine/bus.rs`

---

## Team Composition (Pipelines)

Personas can be composed into **teams** for multi-agent pipeline orchestration:

- **PersonaTeam**: A named workflow with visual canvas data and team-level config.
- **PersonaTeamMember**: A persona assigned to a team with a role and visual position.
  - Roles: `orchestrator`, `worker`, `reviewer`, `router`
- **PersonaTeamConnection**: Directed edge between two team members defining data flow.
  - Connection types: `sequential`, `conditional`, `parallel`, `feedback`
  - Optional `condition` for decision logic
- **PipelineRun**: An execution of the entire team with per-node status tracking.

The Team Canvas UI (`src/features/pipeline/`) uses React Flow to visually compose these pipelines.

---

## Self-Healing

When an execution fails, the healing engine (`src-tauri/src/engine/healing.rs`) classifies the error and recommends an action:

| Category | Detection | Action |
|----------|-----------|--------|
| `RateLimit` | "rate limit", "429", "too many requests" | Exponential backoff (30s base, caps at 5min) |
| `SessionLimit` | Session limit flag | Create issue (manual) |
| `Timeout` | Timeout flag or "timed out" | 1st: retry with 2x timeout. 2nd+: create issue |
| `CliNotFound` | "not found", "ENOENT" | Create issue (install Claude CLI) |
| `CredentialError` | "401", "403", "decrypt", "api key" | Create issue (check credential) |
| `Unknown` | No pattern match | Create issue |

Auto-fixable categories (`RateLimit`, `Timeout` on first occurrence) are retried automatically. All others create a `PersonaHealingIssue` for manual resolution.

---

## Design System

The Design Engine generates a complete persona configuration from a natural-language instruction:

### Input
- User instruction (e.g., "Monitor my Gmail and create ClickUp tasks for actionable emails")
- Available tools and connectors in the system
- Optional design context: files (API specs, schemas, MCP configs) and reference URLs

### Output: `DesignAnalysisResult`

```typescript
{
  structured_prompt:    { identity, instructions, toolGuidance, examples, errorHandling, customSections },
  suggested_tools:      ["http_request", "file_read"],
  suggested_triggers:   [{ trigger_type, config, description }],
  suggested_connectors: [{ name, oauth_type, credential_fields, setup_instructions }],
  full_prompt_markdown: "# Complete System Prompt...",
  summary:              "One-paragraph summary",
  design_highlights:    [{ category, icon, color, items }],
  suggested_notification_channels: [{ type, description, required_connector }],
  suggested_event_subscriptions:   [{ event_type, description }],
  feasibility:          { confirmed_capabilities, issues, overall }
}
```

### Design Lifecycle

```
idle → analyzing → preview | awaiting-input → applying → applied
                     ↕                                      ↓
                  refining                              (persona updated)
```

1. **Analyze**: User provides instruction → Claude generates a `DesignAnalysisResult`.
2. **Question**: If the instruction is ambiguous, Claude may ask a clarifying question instead of producing a full result.
3. **Preview**: User reviews the generated design, highlights, and suggestions.
4. **Refine**: User provides feedback → Claude updates the design.
5. **Feasibility**: System checks suggested tools/connectors exist and trigger types are valid.
6. **Apply**: Design result is applied to the persona (structured_prompt, tools, triggers).

### Design Reviews

Designs can be tested via `PersonaDesignReview`:
- Test cases are run against the design engine
- Structural scoring (does the output have all required sections?)
- Semantic scoring (is the content meaningful and correct?)
- Use-case flows are extracted and stored
- Patterns are extracted into `PersonaDesignPattern` for reuse

Source: `src-tauri/src/engine/design.rs`, `src-tauri/src/commands/design/`

---

## Observability

### Per-Execution Metrics
Every execution tracks: `input_tokens`, `output_tokens`, `cost_usd`, `duration_ms`, `model_used`, `tool_steps`.

### Daily Snapshots (`PersonaMetricsSnapshot`)
Aggregated daily per persona: total/successful/failed executions, total cost, total tokens, average duration, tools used, events emitted/consumed, messages sent.

### Budget Controls
- `max_budget_usd`: Per-execution cost cap (passed to Claude CLI as `--max-budget-usd`)
- `max_turns`: Conversation turn limit (passed as `--max-turns`)
- `BudgetAlertRule`: Configurable alerts when spending thresholds are crossed

### Tool Usage Analytics (`PersonaToolUsage`)
Tracks which tools were invoked, how many times, and by which persona across executions.

---

## Notifications

A Persona can notify the user through multiple channels configured in `notification_channels` (JSON array):

```typescript
{ type: "slack" | "telegram" | "email", enabled: boolean, credential_id?: string, config: Record<string, string> }
```

Messages created via the User Message protocol are delivered through `PersonaMessageDelivery` with per-channel status tracking (`pending`, `delivered`, `failed`).

---

## Templates & Import

### Builtin Templates
JSON files in `scripts/templates/` define complete persona configurations including structured prompts, suggested tools, triggers, and connectors. The `BuiltinTemplate` type wraps a `DesignAnalysisResult` payload with metadata (name, icon, color, category).

Example: `gmail-maestro.json` — a full email lifecycle manager with ~50KB of detailed instructions.

### n8n Import
n8n workflow JSON can be transformed into a persona configuration via `src-tauri/src/commands/design/n8n_transform.rs`. The transformer maps n8n nodes to persona tools and connections to triggers.

### Import/Export
Personas can be exported to and imported from JSON files via `src-tauri/src/commands/core/import_export.rs`.

---

## Summary Table

| Aspect | Detail |
|--------|--------|
| **Identity** | Name, description, icon, color, group |
| **Instructions** | Two-tier: simple `system_prompt` or rich `structured_prompt` with 6 sections |
| **Model** | Configurable provider (Anthropic, Ollama, LiteLLM, custom) with per-persona override |
| **Tools** | Many-to-many assignment from a global tool catalog. 7 builtins. |
| **Triggers** | Manual, schedule (cron), polling (interval), webhook |
| **Credentials** | Encrypted, connector-based, injected as env vars at runtime |
| **Execution** | Spawns Claude CLI, streams output, captures metrics and tool usage |
| **Communication** | 6 protocols: user message, persona action, emit event, agent memory, manual review, execution flow |
| **Events** | Pub/sub event bus with wildcard source filtering |
| **Teams** | Visual pipeline composition with roles and connection types |
| **Memory** | Persistent knowledge store with categories and importance |
| **Healing** | Auto-diagnosis and retry for rate limits and timeouts |
| **Design** | AI-powered prompt generation from natural-language instructions |
| **Observability** | Per-execution metrics, daily snapshots, budget controls, tool analytics |
| **Versioning** | Prompt history with version numbers and change summaries |
