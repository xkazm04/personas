# Personas App Context Map — Test Automation Reference

Quick-reference for translating user intent → automation actions.
Read this at conversation start to understand how to test any workflow.

---

## Navigation

### Sidebar Sections (10)

| Section | testid | Store Action |
|---|---|---|
| Home | `sidebar-home` | `navigate("home")` |
| Overview | `sidebar-overview` | `navigate("overview")` |
| Agents | `sidebar-personas` | `navigate("personas")` |
| Events | `sidebar-events` | `navigate("events")` |
| Keys | `sidebar-credentials` | `navigate("credentials")` |
| Templates | `sidebar-design-reviews` | `navigate("design-reviews")` |
| Teams | `sidebar-team` | `navigate("team")` |
| Cloud | `sidebar-cloud` | `navigate("cloud")` |
| Dev Tools | `sidebar-dev-tools` | `navigate("dev-tools")` |
| Settings | `sidebar-settings` | `navigate("settings")` |

### Section Sub-Tabs

**Home:** welcome, system-check (dev)
**Overview:** home, executions, manual-review, messages, events, knowledge, sla, schedules
**Credentials:** credentials, databases, from-template, add-new
**Templates:** n8n, generated
**Cloud:** unified, cloud, gitlab
**Settings:** account, appearance, notifications, engine (dev), byom (dev), portability, network, admin (dev)
**Dev Tools:** projects, context-map, idea-scanner, idea-triage, task-runner
**Editor:** use-cases, prompt, lab, connectors, chat, design, health, settings

Tab selectors: `[data-testid="tab-{tabId}"]`

### Footer Buttons

| Button | testid | Action |
|---|---|---|
| Collapse sidebar | `footer-collapse` | Toggle sidebar width |
| Account / Sign in | `footer-account` | Auth menu or Google login |
| Theme picker | `footer-theme` | Theme dropdown |
| Network settings | `footer-network` | Navigate to settings → network |

### Title Bar

| Button | testid |
|---|---|
| Minimize | `titlebar-minimize` |
| Maximize | `titlebar-maximize` |
| Close | `titlebar-close` |

---

## Agents (Personas)

### View Agent List
```
navigate("personas")
→ Shows: Agent Surface with cards grouped by status (Active/Idle/Needs Attention)
→ Cards: [data-testid="overview-agent-{id}"]
→ Sidebar cards: [data-testid="agent-card-{id}"]
→ Search: [data-testid="agent-search"]
→ Create: [data-testid="create-agent-btn"]
```

### Create Agent (Build Session)
```
1. navigate("personas")
2. click('[data-testid="create-agent-btn"]')
3. wait_for('[data-testid="agent-intent-input"]')
4. type_text('[data-testid="agent-intent-input"]', "Fetch emails and label important ones")
5. click('[data-testid="agent-launch-btn"]')
   → Build session starts, matrix cells populate
   → Backend streams questions via Channel<BuildEvent>
   → User answers questions in spatial popovers
6. wait_for('[data-testid="agent-name-input"]')  (after design completes)
7. type_text('[data-testid="agent-name-input"]', "Email Labeler")
   → Agent created and appears in list
```

**Cancel creation:** `click('[data-testid="agent-cancel-btn"]')`

### Select Agent
```
click('[data-testid="agent-card-{id}"]')   # sidebar card
click('[data-testid="overview-agent-{id}"]')  # overview card
→ Opens PersonaEditor with tabs
```

### Edit Agent Settings
```
1. Select agent (above)
2. click('[data-testid="editor-tab-settings"]')
3. Fields available:
   - Name: [data-testid="agent-name"]
   - Description: [data-testid="agent-description"]
   - Enabled: [data-testid="agent-enabled"]
4. Changes auto-save (watch SettingsStatusBar)
```

### Delete Agent
```
Method 1 — Editor settings tab:
1. click('[data-testid="agent-delete-btn"]')
2. click('[data-testid="agent-delete-confirm"]')

Method 2 — Context menu (right-click agent card):
1. Right-click agent card
2. click('[data-testid="ctx-delete"]')
3. Confirm deletion
```

### Agent Context Menu (right-click card)
| Action | testid |
|---|---|
| Toggle enabled | `ctx-toggle-enabled` |
| Duplicate | `ctx-duplicate` |
| Export .persona | `ctx-export` |
| Delete | `ctx-delete` |

### Editor Tabs
| Tab | testid | Purpose |
|---|---|---|
| Use Cases | `editor-tab-use-cases` | Define what agent does |
| Prompt | `editor-tab-prompt` | Edit system prompt |
| Lab | `editor-tab-lab` | Version management, A/B testing |
| Connectors | `editor-tab-connectors` | Attach tools/APIs |
| Chat | `editor-tab-chat` | Chat with agent |
| Design | `editor-tab-design` | AI design analysis |
| Health | `editor-tab-health` | Health monitoring |
| Settings | `editor-tab-settings` | Name, description, toggles |

---

## Credentials (Keys)

### View Credentials
```
navigate("credentials")
→ testid: credential-manager
→ Search: [data-testid="credential-search"]
→ List: [data-testid="credential-list"]
```

### Create Credential
```
1. navigate("credentials")
2. click('[data-testid="create-credential-btn"]')
   → Opens provisioning wizard or template form
3. Select credential type (API key, OAuth, database, MCP, etc.)
4. Fill form fields
5. Submit
```

### Credential Types
- **API Key**: base_url, api_key
- **Bearer Token**: base_url, bearer_token
- **Basic Auth**: base_url, username, password
- **OAuth**: provider-specific flow
- **Database**: host, port, database, username, password, ssl_mode
- **MCP Server (stdio)**: command, working_directory
- **MCP Server (SSE)**: url, auth_token

---

## Settings

### Navigate to Settings Tab
```
navigate("settings")
click('[data-testid="tab-{tabId}"]')
```

### Available Tabs
| Tab | testid | Key Controls |
|---|---|---|
| Account | `tab-account` | Tier selector, Google sign-in |
| Appearance | `tab-appearance` | Theme grid, text size, timezone |
| Notifications | `tab-notifications` | Severity toggles, digest |
| Engine | `tab-engine` | Engine config (dev only) |
| BYOM | `tab-byom` | Model routing (dev only) |
| Data | `tab-portability` | Export/import data |
| Network | `tab-network` | P2P exposure manager |
| Admin | `tab-admin` | Admin controls (dev only) |

---

## Overview Dashboard

```
navigate("overview")
→ testid: overview-page
→ Tabs: home, executions, manual-review, messages, events, knowledge, sla, schedules
→ Dashboard has: execution analytics, date filters, realtime visualization
```

---

## Events & Triggers

```
navigate("events")
→ testid: events-page
→ Tabs:
  - Triggers: [data-testid="events-tab-triggers"]
  - Chains: [data-testid="events-tab-chains"]
  - Subscriptions: [data-testid="events-tab-subscriptions"]
```

---

## Templates

```
navigate("design-reviews")
→ testid: templates-page
→ Tabs: n8n (import), generated (gallery)
→ "Synthesize Team" button for team creation
```

---

## Teams / Pipeline

```
navigate("team")
→ testid: team-canvas
→ React Flow canvas with agent nodes
→ Toolbar: add member, add note, auto layout, save
```

---

## Dev Tools

```
navigate("dev-tools")
→ testid: dev-tools-page
→ Tabs: projects, context-map, idea-scanner, idea-triage, task-runner
→ Tab testids: tab-projects, tab-context-map, etc.
```

---

## Home Page

Quick-access navigation cards to all sections:
```
home-card-overview, home-card-personas, home-card-events,
home-card-credentials, home-card-design-reviews, home-card-team,
home-card-cloud, home-card-dev-tools, home-card-settings
```

---

## App State Shape (from get_state)

```json
{
  "sidebarSection": "home|overview|personas|events|credentials|design-reviews|team|cloud|settings|dev-tools",
  "homeTab": "welcome|system-check",
  "editorTab": "use-cases|prompt|lab|connectors|chat|design|health|settings",
  "cloudTab": "unified|cloud|gitlab",
  "settingsTab": "account|appearance|notifications|engine|byom|portability|network|admin",
  "isLoading": false,
  "error": null,
  "isCreatingPersona": false,
  "selectedPersonaId": "uuid|null",
  "personaCount": 3,
  "personas": [{ "id": "...", "name": "...", "enabled": true }]
}
```

---

## Common Test Patterns

### Verify navigation
```
navigate(section) → get_state() → assert sidebarSection == section
```

### Find and click by text
```
find_text("Button Label") → extract selector → click(selector)
```

### Fill a form
```
click('[data-testid="agent-name"]') → type_text('[data-testid="agent-name"]', "New Name")
```

### Wait for async operation
```
wait_for('[data-testid="element"]', 5000) → proceed when visible
```

### Assert element exists
```
query('[data-testid="element"]') → check length > 0
```
