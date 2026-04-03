# Test Automation Framework Guide

Programmatic control of the Personas desktop app for automated testing — no screenshots, no coordinate guessing, deterministic and fast (~15ms per operation).

## Architecture

```
You (natural language)
 ↓
Claude Code CLI
 ↓  MCP protocol (stdio)
tools/test-mcp/server.py         ← Python MCP server, 20 tools
 ↓  HTTP (localhost:17320)
src-tauri/src/test_automation.rs  ← Rust axum server, feature-gated
 ↓  WebView eval + Tauri IPC
src/test/automation/bridge.ts     ← JS bridge on window.__TEST__
 ↓  Direct Zustand/DOM access
React app                         ← Instant state changes, DOM queries
```

## Quick Start

### 1. Start the app with test automation enabled

```bash
npx tauri dev --features test-automation
```

The app starts normally, plus an HTTP server on `localhost:17320`. The frontend loads a test bridge that exposes `window.__TEST__` for programmatic control.

### 2. Verify it works

```bash
curl http://127.0.0.1:17320/health
# → {"status":"ok","server":"personas-test-automation","version":"0.2.0"}
```

### 3. Connect Claude Code

The MCP server is configured in `.mcp.json` as `personas-test`. Restart your Claude Code session to pick up the tools. Then you can ask things like:

- *"Navigate to the agents page and list all agents"*
- *"Create a new persona that fetches emails"*
- *"Open the settings for the first agent and change its name"*

### 4. Run the smoke test

```bash
uvx --with httpx python tools/test-mcp/smoke_test.py
```

---

## Available Tools (20)

### Primitives (low-level)

| Tool | Args | Description |
|---|---|---|
| `navigate` | `section` | Go to a sidebar section |
| `click` | `selector` | Click element by CSS selector |
| `type_text` | `selector`, `text` | Type into input/textarea |
| `query` | `selector` | Query DOM elements, get metadata |
| `find_text` | `text` | Find elements containing text |
| `get_state` | — | Current app state (section, personas, errors) |
| `wait_for` | `selector`, `timeout_ms?` | Wait for element to appear |
| `list_interactive` | — | List all visible buttons/inputs/links |
| `eval_js` | `js` | Execute arbitrary JS (fire-and-forget) |
| `health` | — | Server health check |

### Workflow Macros (high-level)

| Tool | Args | Description |
|---|---|---|
| `select_agent` | `name_or_id` | Find agent by partial name, open editor |
| `open_editor_tab` | `tab` | Switch editor tab (prompt, settings, etc.) |
| `start_create_agent` | — | Open the creation wizard |
| `snapshot` | — | Semantic view: route, modals, toasts, errors, forms |
| `agent_cards` | — | Get all visible agent cards |
| `fill_field` | `test_id`, `value` | Fill form field by data-testid |
| `click_testid` | `test_id` | Click element by data-testid |
| `search_agents` | `query` | Filter agent list |
| `open_settings_tab` | `tab` | Navigate to a settings sub-tab |
| `wait_toast` | `text`, `timeout_ms?` | Wait for toast notification |

---

## Valid Identifiers

### Sidebar Sections

```
home, overview, personas, events, credentials,
design-reviews, team, cloud, settings, dev-tools
```

### Editor Tabs

```
use-cases, prompt, lab, connectors, chat, design, health, settings
```

### Settings Tabs

```
account, appearance, notifications, engine, byom, portability, network, admin
```

### Overview Tabs

```
home, executions, manual-review, messages, events, knowledge, sla, schedules
```

### Dev Tools Tabs

```
projects, context-map, idea-scanner, idea-triage, task-runner
```

---

## data-testid Reference

Stable selectors that survive UI refactors. Use with `click_testid` and `fill_field`.

### Navigation

| testid | Element |
|---|---|
| `sidebar-home` | Home nav button |
| `sidebar-overview` | Overview nav button |
| `sidebar-personas` | Agents nav button |
| `sidebar-events` | Events nav button |
| `sidebar-credentials` | Keys nav button |
| `sidebar-design-reviews` | Templates nav button |
| `sidebar-team` | Teams nav button |
| `sidebar-cloud` | Cloud nav button |
| `sidebar-dev-tools` | Dev Tools nav button |
| `sidebar-settings` | Settings nav button |
| `tab-{id}` | Any sub-tab button (e.g., `tab-account`) |

### Window Controls

| testid | Element |
|---|---|
| `titlebar-minimize` | Minimize window |
| `titlebar-maximize` | Maximize/restore window |
| `titlebar-close` | Close window |
| `footer-collapse` | Toggle sidebar collapse |
| `footer-account` | Account / sign-in button |
| `footer-theme` | Theme picker |
| `footer-network` | Network settings shortcut |

### Agent CRUD

| testid | Element |
|---|---|
| `create-agent-btn` | "New Agent" button in sidebar |
| `agent-search` | Agent search/filter input |
| `agent-card-{id}` | Sidebar agent card |
| `overview-agent-{id}` | Overview page agent card |
| `agent-intent-input` | Creation wizard intent textarea |
| `agent-launch-btn` | Launch build session button |
| `agent-name-input` | Agent name field in creation flow |
| `agent-cancel-btn` | Cancel creation button |

### Agent Editor

| testid | Element |
|---|---|
| `editor-tab-use-cases` | Use Cases tab |
| `editor-tab-prompt` | Prompt tab |
| `editor-tab-lab` | Lab tab |
| `editor-tab-connectors` | Connectors tab |
| `editor-tab-chat` | Chat tab |
| `editor-tab-design` | Design tab |
| `editor-tab-health` | Health tab |
| `editor-tab-settings` | Settings tab |
| `agent-name` | Name input (settings tab) |
| `agent-description` | Description textarea (settings tab) |
| `agent-enabled` | Enabled toggle (settings tab) |
| `agent-delete-btn` | Delete button |
| `agent-delete-confirm` | Confirm delete button |
| `agent-test-btn` | Test Agent button (draft_ready phase) |

### Lab (Test Arena)

| testid | Element |
|---|---|
| `lab-mode-arena` | Arena mode tab |
| `lab-mode-ab` | A/B test mode tab |
| `lab-mode-eval` | Eval mode tab |
| `lab-mode-matrix` | Matrix mode tab |
| `lab-mode-versions` | Versions mode tab |
| `arena-run-btn` | Run Arena button |
| `arena-cancel-btn` | Cancel Arena test |
| `arena-model-{id}` | Model toggle (e.g., `arena-model-sonnet`) |
| `run-test-btn` | Run Test button (PersonaTestsTab) |
| `cancel-test-btn` | Cancel Test Run button |
| `test-usecase-filter` | Use case filter dropdown |
| `model-toggle-{id}` | Model toggle (e.g., `model-toggle-sonnet`) |
| `test-run-{id}` | Test run row container |
| `test-run-expand-{id}` | Expand/collapse test run |
| `test-run-delete-{id}` | Delete test run |

### Execution

| testid | Element |
|---|---|
| `execute-persona-btn` | Execute/Stop persona button |
| `runner-toggle-input` | Toggle input data editor |
| `runner-budget-override` | Override budget pause |
| `exec-toggle-raw` | Toggle raw/masked output |
| `exec-toggle-compare` | Toggle compare mode |
| `exec-show-comparison` | Show comparison (when 2 selected) |
| `exec-try-it` | "Try it now" empty state button |
| `exec-row-{id}` | Execution history row |

### Agent Context Menu (right-click card)

| testid | Element |
|---|---|
| `ctx-toggle-enabled` | Enable/disable agent |
| `ctx-duplicate` | Duplicate agent |
| `ctx-export` | Export .persona file |
| `ctx-delete` | Delete agent |

### Credentials

| testid | Element |
|---|---|
| `credential-manager` | Main credential container |
| `credential-search` | Search input |
| `credential-list` | Credential list container |
| `create-credential-btn` | Add new credential button |

### Credential Creation (Vault "Add New")

| testid | Element |
|---|---|
| `vault-type-picker` | Type picker container (all options) |
| `vault-pick-ai-connector` | AI-Built Connector option |
| `vault-pick-mcp` | AI Tool Server option |
| `vault-pick-custom` | Web Service option |
| `vault-pick-database` | Database option |
| `vault-pick-desktop` | Desktop App option |
| `vault-pick-wizard` | AI Setup Wizard option |
| `vault-pick-autopilot` | API Autopilot option |
| `vault-pick-workspace` | Workspace Connect option |
| `vault-pick-foraging` | Auto-Discover option |
| `vault-back-btn` | Back to type picker |
| `vault-add-views` | Add views container |

### Credential Creation — AI-Built Connector

| testid | Element |
|---|---|
| `vault-design-container` | Design flow container |
| `vault-design-input` | Description textarea |
| `vault-design-submit` | "Design Credential" button |
| `vault-design-cancel` | Cancel/close button |

### Credential Creation — Schema Form (MCP / Custom / Database)

| testid | Element |
|---|---|
| `vault-schema-form` | Form container |
| `vault-schema-name` | Credential name input |
| `vault-schema-subtype` | Subtype selector |
| `vault-schema-save` | Save credential button |
| `vault-schema-cancel` | Cancel button |

### Credential Creation — API Autopilot

| testid | Element |
|---|---|
| `vault-autopilot-container` | Autopilot container |
| `vault-autopilot-url-input` | OpenAPI URL/spec input |
| `vault-autopilot-submit` | Submit URL button |
| `vault-autopilot-preview` | Preview step container |
| `vault-autopilot-confirm` | Confirm/generate button |

### Credential Creation — Other Flows

| testid | Element |
|---|---|
| `vault-wizard-container` | AI Setup Wizard container |
| `vault-wizard-start` | Start wizard button |
| `vault-wizard-cancel` | Cancel wizard |
| `vault-wizard-next` | Next step |
| `vault-desktop-container` | Desktop discovery container |
| `vault-desktop-scan` | Scan/refresh button |
| `vault-desktop-import-mcp` | Import Claude MCP tab |
| `vault-workspace-container` | Workspace Connect container |
| `vault-workspace-connect` | Connect button |
| `vault-foraging-container` | Auto-discover container |
| `vault-foraging-scan` | Start scan button |

### Page Containers

| testid | Element |
|---|---|
| `settings-page` | Settings page root |
| `events-page` | Events page root |
| `overview-page` | Overview page root |
| `templates-page` | Templates page root |
| `dev-tools-page` | Dev Tools page root |
| `team-canvas` | Team pipeline canvas |

### Events Page

| testid | Element |
|---|---|
| `events-tab-triggers` | Triggers tab |
| `events-tab-chains` | Chains tab |
| `events-tab-subscriptions` | Subscriptions tab |

### Home Page Cards

| testid | Element |
|---|---|
| `home-card-overview` | Overview quick-nav card |
| `home-card-personas` | Agents quick-nav card |
| `home-card-events` | Events quick-nav card |
| `home-card-credentials` | Keys quick-nav card |
| `home-card-design-reviews` | Templates quick-nav card |
| `home-card-team` | Teams quick-nav card |
| `home-card-cloud` | Cloud quick-nav card |
| `home-card-dev-tools` | Dev Tools quick-nav card |
| `home-card-settings` | Settings quick-nav card |

---

## Common Workflows

### Create an agent

```
1. start_create_agent()
2. wait_for('[data-testid="agent-intent-input"]')
3. fill_field("agent-intent-input", "Fetch emails and label important ones")
4. click_testid("agent-launch-btn")
   → Build session starts, matrix cells populate with questions
5. wait_for('[data-testid="agent-name-input"]')   (design completes)
6. fill_field("agent-name-input", "Email Labeler")
   → Agent finalized
```

### Edit an agent's name

```
1. select_agent("Email")          → finds "Email Labeler" by partial match
2. open_editor_tab("settings")
3. fill_field("agent-name", "Email Sorter")
   → Auto-saves
```

### Delete an agent

```
1. select_agent("Email Sorter")
2. open_editor_tab("settings")
3. click_testid("agent-delete-btn")
4. click_testid("agent-delete-confirm")
```

### Navigate and verify

```
1. navigate("credentials")
2. get_state()                    → { sidebarSection: "credentials", ... }
3. snapshot()                     → full semantic view with forms, modals, errors
```

### Search agents

```
1. search_agents("email")
2. agent_cards()                  → filtered list of matching cards
```

### Check what's on screen

```
snapshot()
→ Returns:
{
  "route": "personas",
  "pageTitle": "Agent Surface",
  "personaCount": 3,
  "modals": [],
  "toasts": [],
  "errors": [],
  "forms": [
    { "testId": "agent-search", "placeholder": "Search agents...", "value": "" }
  ]
}
```

---

## File Structure

```
src/test/automation/
  bridge.ts                    ← Frontend bridge (window.__TEST__)

src-tauri/src/
  test_automation.rs           ← Rust HTTP server (feature: test-automation)

tools/test-mcp/
  server.py                    ← Python MCP server (20 tools)
  requirements.txt             ← Python deps (mcp, httpx)
  smoke_test.py                ← 28-test validation suite
  APP_CONTEXT_MAP.md           ← Detailed intent → selector mapping

.mcp.json                      ← MCP server configuration
```

## Feature Gate

The test automation server is compiled only when the `test-automation` Cargo feature is enabled. It adds zero overhead to production builds.

```toml
# src-tauri/Cargo.toml
[features]
test-automation = []
```

The frontend bridge is loaded only in dev mode (`import.meta.env.DEV`), tree-shaken from production builds.

---

## Extending

### Add a new data-testid

Add `data-testid="my-element"` to any React component. It's immediately usable via `click_testid("my-element")` or `fill_field("my-element", "...")`.

### Add a new workflow macro

1. Add a method to `bridge.ts` in the workflow macros section
2. Add an HTTP handler + route in `test_automation.rs`
3. Add a tool definition + routing in `server.py`

### Run tests without Claude Code

The HTTP API is plain REST. Use curl, Python, or any HTTP client:

```bash
# Navigate
curl -X POST http://127.0.0.1:17320/navigate -H "Content-Type: application/json" -d '{"section":"personas"}'

# Get state
curl http://127.0.0.1:17320/state

# Semantic snapshot
curl http://127.0.0.1:17320/snapshot

# Select agent by name
curl -X POST http://127.0.0.1:17320/select-agent -H "Content-Type: application/json" -d '{"name_or_id":"Email"}'
```

---

## Production Build Testing

The test automation server is also available in **production builds** via the `PERSONAS_TEST_PORT` environment variable. This allows smoke testing installed packages without recompiling.

### How it works

| Mode | Trigger | Port | Frontend bridge |
|------|---------|------|----------------|
| Dev | `--features test-automation` | 17320 (fixed) | Loaded via `import.meta.env.DEV` |
| Production | `PERSONAS_TEST_PORT=<port>` | Custom (e.g. 17321) | Loaded via `window.__PERSONAS_TEST_MODE__` |

When `PERSONAS_TEST_PORT` is set, the Rust backend:
1. Starts the HTTP test server on the specified port
2. Injects `window.__PERSONAS_TEST_MODE__ = true` via `js_init_script`
3. The frontend detects the flag and loads `window.__TEST__` bridge

### Running production smoke tests

```bash
# 1. Launch installed app with test mode enabled
$env:PERSONAS_TEST_PORT = "17321"   # PowerShell
& "C:\Users\kazda\AppData\Local\Personas\personas-desktop.exe"

# Or on bash:
PERSONAS_TEST_PORT=17321 /path/to/personas-desktop &

# 2. Verify the server is up
curl http://127.0.0.1:17321/health

# 3. Run production smoke tests
uvx --with httpx python tools/test-mcp/production_smoke_test.py --port 17321
```

### Running both dev and production simultaneously

Dev and production can run side-by-side on different ports:

```bash
# Terminal 1: Dev app on default port
npx tauri dev --features test-automation
# → http://127.0.0.1:17320

# Terminal 2: Production app on custom port
PERSONAS_TEST_PORT=17321 "C:\...\personas-desktop.exe"
# → http://127.0.0.1:17321

# Terminal 3: Run smoke tests against production
uvx --with httpx python tools/test-mcp/production_smoke_test.py --port 17321
```

### What the production smoke tests cover

| # | Test | Description |
|---|------|-------------|
| 0 | Health check | Server connectivity |
| 1 | Sidebar sections | All 7 main sections render without errors |
| 2 | Overview sub-tabs | Dashboard, Executions, Approvals, Messages, Events, Knowledge |
| 3 | Settings sub-tabs | Appearance, Notifications, Portability |
| 4 | Credentials module | Loads without "startup failed" errors |
| 5 | Agent creation | Opens creation wizard, fills name + instruction |
| 6 | Agent execution | Executes first available agent |
| 7 | Artifact verification | Checks all Overview tabs render after execution |
| 8 | Exploratory nav | Clicks through all 1st + 2nd level menu items |

### MCP server with custom port

To use Claude Code's MCP tools against a production build, update `.mcp.json`:

```json
{
  "mcpServers": {
    "personas-test-prod": {
      "command": "uvx",
      "args": ["--with", "mcp", "python", "tools/test-mcp/server.py", "--port", "17321"]
    }
  }
}
```

Then ask Claude Code to run tests against the production instance.
