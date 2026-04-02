# Claude Desktop Integration

Personas exposes a Model Context Protocol (MCP) server that connects to Claude Desktop, enabling full agent management, lab testing, prompt optimization, and health monitoring from within Claude Desktop conversations.

## Architecture

```
Claude Desktop / Claude Code CLI
  |
  |  stdio (MCP protocol)
  v
scripts/mcp-server/index.mjs          MCP Server (23 tools)
  |                                      |
  |  SQLite read (WAL-safe)              |  HTTP (localhost:9420)
  v                                      v
personas.db                           Management API (axum)
  (read-only queries)                   (mutations + execution)
                                          |
                                          v
                                       Personas Tauri App
                                         (engine, scheduler, CLI)
```

**Read operations** (list personas, view executions, check health) query the SQLite database directly — these work even when the Personas app is closed.

**Write operations** (execute persona, start lab test, improve prompt) call the Management API on port 9420 — these require the Personas app to be running.

---

## Setup

### One-Click (from Personas app)

1. Open **Home > System Checks** (the first page after launch)
2. In the **Local Environment** section, find **Claude Desktop Integration**
3. Click **Connect to Claude Desktop**
4. Restart Claude Desktop

The button writes the MCP server configuration to `claude_desktop_config.json` automatically.

### Manual (Claude Desktop)

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "personas": {
      "command": "node",
      "args": ["<path-to-personas>/scripts/mcp-server/index.mjs"]
    }
  }
}
```

### Manual (Claude Code CLI)

```bash
claude mcp add-json personas '{"command":"node","args":["<path>/scripts/mcp-server/index.mjs"]}'
```

---

## Available Tools (23)

### Agent Management (read-only)

| Tool | Description |
|---|---|
| `list_personas` | All agents with status, model, group |
| `get_persona_detail` | Full detail: prompt sections, tools, triggers, recent executions |
| `get_persona_health` | Error rate, monthly spend, healing issues, assertion pass rates |
| `get_system_overview` | System-wide stats: agent count, 24h executions, total cost |
| `list_credentials` | Credential names and types (never secrets) |
| `search_knowledge` | Query the knowledge graph for learned patterns |

### Execution

| Tool | Description |
|---|---|
| `run_persona` | Execute via Management API (no webhook trigger needed, app must be running) |
| `execute_persona` | Execute via webhook trigger (legacy, requires configured webhook) |
| `list_executions` | Recent executions with persona/status filters |
| `get_execution_output` | Full output, tool steps, and execution flows |

### Lab & Quality

| Tool | Description |
|---|---|
| `start_arena_test` | Compare a persona across multiple models |
| `start_matrix_improvement` | Generate improved prompt variant + compare against current |
| `cancel_lab_run` | Cancel any running lab test |
| `get_lab_results` | Detailed scores from a completed run |
| `list_lab_runs` | Run history by type (test/arena/ab/matrix/eval) |
| `improve_prompt_from_results` | Auto-improve prompt based on lab scores (LLM call) |

### Version Management

| Tool | Description |
|---|---|
| `list_prompt_versions` | Version history with production/experimental/archived tags |
| `tag_prompt_version` | Tag a version as production, experimental, or archived |
| `rollback_prompt_version` | Restore a previous prompt version |
| `accept_matrix_draft` | Promote a matrix-generated draft to the live persona |

### Automation Settings

| Tool | Description |
|---|---|
| `configure_auto_optimize` | Enable/disable automatic prompt optimization |
| `configure_health_watch` | Enable/disable continuous health monitoring |

---

## Feature 1: Auto-Optimization Loop

**What it does:** Periodically runs an arena test on a persona and auto-improves the prompt when scores fall below a threshold.

**Where to find it:** Open any agent > **Lab tab** > look for the **Auto-Optimize** toggle (top-right, with lightning bolt icon).

**How it works:**

1. When enabled, the setting is stored in the app database as `auto_optimize:<persona_id>`
2. The configuration includes:
   - **Cron schedule** (default: `0 2 * * 0` — Sunday 2 AM)
   - **Minimum score threshold** (default: 80/100)
   - **Models to test** (default: Sonnet)
3. When the schedule fires, an arena test runs with the configured models
4. If any score dimension (tool accuracy, output quality, protocol compliance) falls below the threshold, the prompt improvement engine generates a better version
5. The improved version is saved as an `experimental` prompt version
6. Users review and optionally promote to `production` via the Versions panel

**Via Claude Desktop:**

```
"Enable auto-optimization for my Tech News Digest agent with a minimum score of 85"
```

Claude calls `configure_auto_optimize(persona: "Tech News Digest", enabled: true, min_score: 85)`.

**Via Management API:**

```bash
curl -X POST http://127.0.0.1:9420/api/settings/auto-optimize/<persona_id> \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"cron":"0 2 * * 0","min_score":80,"models":["sonnet"]}'
```

**Visual indicator:** When enabled, the toggle shows a green dot and `bg-emerald` accent. The `data-testid` is `auto-optimize-toggle`.

---

## Feature 2: Health Watch

**What it does:** Continuously monitors a persona's health metrics and sends notifications when degradation is detected (error rate spikes, budget overruns, unresolved healing issues).

**Where to find it:** Open any agent > **Health tab** > look for the **Health Watch** toggle (top-right, with eye icon).

**How it works:**

1. When enabled, stored as `health_watch:<persona_id>` in the settings database
2. Configuration:
   - **Check interval** (default: 6 hours)
   - **Error rate threshold** (default: 30% — alerts if more than 30% of recent executions failed)
3. Each check evaluates:
   - Recent execution success/failure ratio
   - Monthly spend vs. budget limit
   - Unresolved healing issues count
   - Output assertion pass rates
4. When thresholds are breached, notifications are sent through the persona's configured notification channels (Slack, Telegram, Email, OS notification)

**Via Claude Desktop:**

```
"Enable health monitoring for all my agents with a 25% error threshold"
```

Claude iterates personas and calls `configure_health_watch` for each.

**Via Management API:**

```bash
curl -X POST http://127.0.0.1:9420/api/settings/health-watch/<persona_id> \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"interval_hours":6,"error_threshold":30}'
```

**Visual indicator:** Cyan dot and `bg-cyan` accent when active. The `data-testid` is `health-watch-toggle`.

---

## Example Workflows in Claude Desktop

### Weekly Optimization Sweep

> "For each of my enabled personas, run an arena test with Sonnet, check the results, and improve any with scores below 80%"

### Health Dashboard

> "Show me the health of all my agents — which ones have errors, what's my total spend this month?"

### Prompt Lifecycle

> "List the prompt versions for my SEC Filing Analyzer, compare the last two in an A/B test, and if the newer one scores higher, tag it as production"

### Quick Execution

> "Run my Daily Programming Learner agent with input: { topic: 'Rust async patterns' }"

### Setup Monitoring

> "Enable health watch on all my agents with a 4-hour interval and 20% error threshold, and enable auto-optimization for my most important agent"

---

## Technical Details

### Settings Storage

All three features store their configuration in the `app_settings` SQLite table:

| Key Pattern | Value Format |
|---|---|
| `auto_optimize:<persona_id>` | `{"enabled":true,"cron":"0 2 * * 0","min_score":80,"models":["sonnet"]}` |
| `health_watch:<persona_id>` | `{"enabled":true,"interval_hours":6,"error_threshold":30}` |

### Management API Port

All write operations go through `http://127.0.0.1:9420/api/*`. This is the same HTTP server that handles webhook triggers, extended with management routes when the app starts.

### MCP Server Location

`<project_root>/scripts/mcp-server/index.mjs`

Dependencies: `@modelcontextprotocol/sdk`, `sql.js`, `zod` (installed via `npm install` in that directory).

### Test Suites

| Test | Command | Tools Tested |
|---|---|---|
| Full MCP suite (24 tests) | `node scripts/mcp-server/test-tools.mjs` | All read + write tools |
| Schedule features (5 tests) | `node scripts/mcp-server/test-schedule-features.mjs` | auto-optimize, health-watch |
| Live integration (11 steps) | `node scripts/mcp-server/test-live.mjs` | Arena test + improve + version lifecycle |
