# Cloud Deployment Guide

Deploy personas to the cloud orchestrator for server-side execution with event-driven triggers, persistent history, and multi-worker scaling.

## Architecture Overview

```
                          +-----------------+
                          |  GitLab / Slack  |
                          |   (Webhooks)     |
                          +--------+--------+
                                   |
                                   v
+------------------+    +-------------------+    +------------------+
|  Desktop App     |--->|   Orchestrator    |--->|   Worker(s)      |
|  (Personas)      |    |                   |    |                  |
|                  |    |  - HTTP API       |    |  - Claude CLI    |
|  Design & manage |    |  - SQLite DB      |    |  - OAuth tokens  |
|  personas locally|    |  - Event Bus      |    |  - Env var inject|
|                  |    |  - Trigger Sched. |    |                  |
+------------------+    |  - Kafka (opt.)   |    +------------------+
                        +-------------------+
                                   |
                                   v
                          +-----------------+
                          |  SQLite DB      |
                          |  (personas.db)  |
                          +-----------------+
```

The orchestrator is the central coordination layer. It stores personas, credentials, triggers, and event subscriptions in a SQLite database. Workers connect via WebSocket and execute Claude CLI with injected credentials and assembled prompts.

---

## Prerequisites

### Required

- **Node.js 18+** with npm
- **Claude CLI** installed on all worker machines (`npm install -g @anthropic-ai/claude-code`)
- **Anthropic subscription** (Claude Pro/Team/Enterprise) for OAuth, or a direct API key
- **Environment variables** (see [Configuration](#configuration))

### Optional

- **Kafka cluster** for distributed event streaming (falls back to in-memory when not configured)
- **GitLab project** for webhook-driven execution
- **Multiple worker machines** for horizontal scaling

---

## Configuration

Set these environment variables before starting the orchestrator:

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTER_KEY` | Yes | Hex-encoded secret for AES-256-GCM encryption of credentials |
| `TEAM_API_KEY` | Yes | Bearer token for HTTP API authentication |
| `WORKER_TOKEN` | Yes | Token workers use to authenticate WebSocket connections |
| `CLAUDE_TOKEN` | No | Direct Claude API/OAuth token (skip OAuth flow) |
| `KAFKA_BROKERS` | No | Comma-separated Kafka broker addresses |
| `KAFKA_USERNAME` | No | SASL username for Kafka |
| `KAFKA_PASSWORD` | No | SASL password for Kafka |
| `WS_PORT` | No | WebSocket port for workers (default: `8443`) |
| `HTTP_PORT` | No | HTTP API port (default: `3001`) |
| `DAC_DB_PATH` | No | SQLite database file path (default: `./data/personas.db`) |

### Generating a Master Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Generating a Team API Key

```bash
node -e "console.log('dac_' + require('crypto').randomBytes(24).toString('hex'))"
```

---

## Quick Start

### 1. Install and Build

```bash
cd personas-cloud
npm install
npm run build        # builds shared -> orchestrator -> worker
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your MASTER_KEY, TEAM_API_KEY, WORKER_TOKEN
```

### 3. Start Orchestrator

```bash
cd packages/orchestrator
npm run dev
```

The orchestrator starts the HTTP API (port 3001), WebSocket server (port 8443), event processor (2s tick), and trigger scheduler (5s tick).

### 4. Start Worker

```bash
cd packages/worker
ORCHESTRATOR_URL=ws://localhost:8443 WORKER_TOKEN=<your-token> npm run dev
```

### 5. Connect Claude Subscription

Either set `CLAUDE_TOKEN` in environment, or use the OAuth flow:

```bash
# Start OAuth flow
curl -X POST http://localhost:3001/api/oauth/authorize \
  -H "Authorization: Bearer <TEAM_API_KEY>"

# Follow the returned authUrl, then exchange the code
curl -X POST http://localhost:3001/api/oauth/callback \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -d '{"code": "<auth-code>", "state": "<state>"}'
```

---

## Deploying a Persona

### Step 1: Register the Persona

```bash
curl -X POST http://localhost:3001/api/personas \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Code Reviewer",
    "description": "Reviews pull requests for code quality",
    "systemPrompt": "You are an expert code reviewer...",
    "structuredPrompt": "{\"identity\":\"Expert code reviewer\",\"instructions\":\"Review code for bugs, security issues, and style violations.\"}",
    "enabled": true,
    "maxConcurrent": 2,
    "timeoutMs": 600000
  }'
```

Returns the full persona object with a generated `id`.

### Step 2: Add Tool Definitions (Optional)

```bash
# Create a tool definition
curl -X POST http://localhost:3001/api/tool-definitions \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gitlab_api",
    "category": "api",
    "description": "Call the GitLab API",
    "scriptPath": "",
    "implementationGuide": "Use curl with $GITLAB_TOKEN to call GitLab API v4 endpoints.",
    "requiresCredentialType": "gitlab"
  }'

# Link tool to persona
curl -X POST http://localhost:3001/api/personas/<persona-id>/tools \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"toolId": "<tool-id>"}'
```

### Step 3: Add Credentials (Optional)

Credentials are stored encrypted using AES-256-GCM. Encrypt the credential JSON before sending:

```bash
curl -X POST http://localhost:3001/api/credentials \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gitlab",
    "serviceType": "gitlab",
    "encryptedData": "<hex-encrypted>",
    "iv": "<hex-iv>",
    "tag": "<hex-tag>",
    "metadata": "{\"fields\": [\"token\"]}"
  }'

# Link credential to persona
curl -X POST http://localhost:3001/api/personas/<persona-id>/credentials \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"credentialId": "<credential-id>"}'
```

At dispatch time, credentials are decrypted and injected as environment variables:
- JSON credentials: `CONNECTOR_{NAME}_{FIELD}` per field
- Plain string credentials: `CONNECTOR_{NAME}`

### Step 4: Execute

```bash
# Direct execution
curl -X POST http://localhost:3001/api/execute \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Review the latest merge request",
    "personaId": "<persona-id>",
    "timeoutMs": 300000
  }'

# Poll for results
curl http://localhost:3001/api/executions/<execution-id> \
  -H "Authorization: Bearer <TEAM_API_KEY>"
```

When a persona is registered in the database, the orchestrator automatically assembles the full prompt (identity, instructions, tools, credentials, protocols) instead of using the raw prompt string.

---

## Event Subscriptions

Event subscriptions let personas react automatically to external events.

### How It Works

```
Event Source (webhook, trigger, manual)
  -> Event stored in DB (status: pending)
    -> Event processor matches subscriptions (every 2s)
      -> Prompt assembled from persona config
        -> Dispatched to available worker
```

### Creating a Subscription

```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "personaId": "<persona-id>",
    "eventType": "gitlab_push",
    "sourceFilter": "org/my-repo",
    "enabled": true
  }'
```

### Matching Rules

1. **Event type** must match exactly (e.g. `gitlab_push`)
2. **Source filter** (optional): exact match or wildcard prefix with `*` (e.g. `org/*` matches `org/repo-a`, `org/repo-b`)
3. **Target persona** (optional): if the event targets a specific persona, only that persona's subscriptions match
4. **Enabled**: disabled subscriptions are skipped

### Publishing Events

Events can arrive from three sources:

**Webhooks** (external services push events):
```bash
# Generic webhook targeting a specific persona
POST /api/webhooks/<persona-id>
Body: <any JSON payload>

# GitLab webhook (auto-maps object_kind to event type)
POST /api/gitlab/webhook
Body: <GitLab webhook payload>
```

**Manual** (programmatic event injection):
```bash
POST /api/events
{
  "eventType": "deploy_requested",
  "sourceType": "manual",
  "sourceId": "slack-bot",
  "payload": "{\"environment\": \"production\"}"
}
```

**Triggers** (scheduled events — see next section).

### Event Lifecycle

| Status | Meaning |
|--------|---------|
| `pending` | Queued for processing |
| `processing` | Being matched against subscriptions |
| `delivered` | All matched personas were dispatched |
| `partial` | Some dispatches succeeded, some failed |
| `skipped` | No subscriptions matched this event |
| `failed` | All dispatches failed |

---

## Trigger Scheduler

Triggers fire events on a schedule, enabling periodic persona execution.

### Creating a Scheduled Trigger

```bash
curl -X POST http://localhost:3001/api/triggers \
  -H "Authorization: Bearer <TEAM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "personaId": "<persona-id>",
    "triggerType": "schedule",
    "config": "{\"cron\": \"every 30m\", \"event_type\": \"scheduled_review\", \"payload\": {\"scope\": \"recent\"}}",
    "enabled": true
  }'
```

### Trigger Types

| Type | How it fires |
|------|-------------|
| `schedule` | Based on `cron` or `interval_seconds` in config |
| `webhook` | When a webhook arrives for the persona |
| `chain` | When another persona's execution emits an event |
| `manual` | Only via explicit API call |
| `polling` | Reserved for content-change detection (not yet implemented in cloud) |

### Schedule Config

The `config` JSON supports:

```json
{
  "cron": "every 30m",           // Simple interval: every Xs, Xm, Xh, Xd
  "interval_seconds": 1800,      // Alternative: fixed interval in seconds
  "event_type": "check_status",  // Event type published when trigger fires
  "payload": { "key": "value" }  // Custom payload passed to persona as input data
}
```

### How Triggers Become Executions

```
Trigger fires (nextTriggerAt <= now)
  -> Event published to event bus
    -> Event processor matches subscription
      -> Persona prompt assembled
        -> Dispatched to worker
```

Triggers don't directly create executions. They publish events to the event bus, which are then matched to subscriptions and dispatched. This means you need both a trigger AND a matching subscription for the persona to execute.

To simplify setup, create a trigger with `targetPersonaId` set — the event processor will match it directly to that persona's subscriptions.

---

## Execution Persistence

All executions are persisted in the SQLite database. They survive orchestrator restarts.

### Querying Executions

```bash
# List recent executions
curl "http://localhost:3001/api/executions?limit=20" \
  -H "Authorization: Bearer <TEAM_API_KEY>"

# Filter by persona
curl "http://localhost:3001/api/executions?personaId=<id>&status=completed&limit=10" \
  -H "Authorization: Bearer <TEAM_API_KEY>"

# Get specific execution with output
curl "http://localhost:3001/api/executions/<execution-id>" \
  -H "Authorization: Bearer <TEAM_API_KEY>"
```

### Execution Lifecycle

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for an available worker |
| `running` | Dispatched to a worker, streaming output |
| `completed` | Finished successfully |
| `failed` | Failed (timeout, worker disconnect, CLI error) |
| `cancelled` | Cancelled via API |

### Concurrency Control

Each persona has a `maxConcurrent` setting (default: 1). The event processor checks the count of running executions before dispatching. If a persona is at capacity, the event match is skipped (counted as a failure for that match, but the event can still deliver to other personas).

---

## Prompt Assembly

When a persona is registered in the cloud DB, the orchestrator assembles the full prompt automatically. The assembled prompt includes (in order):

1. **Header**: `# Persona: {name}`
2. **Description**: persona description
3. **Structured prompt sections**: identity, instructions, tool guidance, examples, error handling, custom sections, web search guidance
4. **Fallback**: `system_prompt` if structured prompt is missing or invalid
5. **Available Tools**: formatted documentation for each linked tool
6. **Execution Environment**: Linux-specific guidance (curl, node, bash)
7. **Available Credentials**: env var names (values are injected, never in the prompt)
8. **Communication Protocols**: 7 protocol blocks (user_message, persona_action, emit_event, agent_memory, manual_review, execution_flow, outcome_assessment)
9. **Input Data**: event payload, use case context, time filter constraints
10. **Execute Now**: final instruction to begin

This is the same prompt structure used by the desktop app, ported from the Rust `engine/prompt.rs` module.

---

## GitLab Integration

See [GitLab Duo Agent Integration](gitlab-duo-agent-integration.md) for full GitLab documentation including:
- Deploying personas as Duo Agents (desktop)
- Credential provisioning to CI/CD variables
- Webhook-driven execution (cloud)
- Pipeline triggering from personas

### Quick GitLab Webhook Setup

1. Register a persona and create a subscription for `gitlab_push` (or any event type)
2. In GitLab: **Settings > Webhooks > Add webhook**
3. URL: `https://<orchestrator>/api/gitlab/webhook`
4. Secret token: your `TEAM_API_KEY` (sent as `Authorization: Bearer <token>` — configure via custom header or proxy)
5. Select events: Push, Merge Request, Pipeline, etc.

---

## API Reference

### Personas

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/personas` | List all personas |
| `GET` | `/api/personas/:id` | Get persona by ID |
| `POST` | `/api/personas` | Create or update persona |
| `DELETE` | `/api/personas/:id` | Delete persona |

### Tools

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/personas/:id/tools` | List tools for persona |
| `POST` | `/api/personas/:id/tools` | Link tool to persona |
| `POST` | `/api/tool-definitions` | Create/update tool definition |

### Credentials

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/credentials` | Store encrypted credential |
| `DELETE` | `/api/credentials/:id` | Delete credential |
| `GET` | `/api/personas/:id/credentials` | List linked credentials (redacted) |
| `POST` | `/api/personas/:id/credentials` | Link credential to persona |

### Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/events` | Publish event to bus |
| `POST` | `/api/webhooks/:personaId` | Webhook for specific persona |
| `POST` | `/api/gitlab/webhook` | GitLab webhook receiver |

### Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/subscriptions` | Create subscription |
| `PUT` | `/api/subscriptions/:id` | Update subscription |
| `DELETE` | `/api/subscriptions/:id` | Delete subscription |
| `GET` | `/api/personas/:id/subscriptions` | List persona's subscriptions |

### Triggers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/triggers` | Create trigger |
| `PUT` | `/api/triggers/:id` | Update trigger |
| `DELETE` | `/api/triggers/:id` | Delete trigger |
| `GET` | `/api/personas/:id/triggers` | List persona's triggers |

### Executions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/execute` | Submit direct execution |
| `GET` | `/api/executions` | List executions (with filters) |
| `GET` | `/api/executions/:id` | Get execution with output |
| `POST` | `/api/executions/:id/cancel` | Cancel running execution |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (unauthenticated) |
| `GET` | `/api/status` | Full system status |
| `POST` | `/api/oauth/authorize` | Start OAuth flow |
| `POST` | `/api/oauth/callback` | Exchange OAuth code |
| `GET` | `/api/oauth/status` | Check OAuth status |
| `POST` | `/api/oauth/refresh` | Refresh OAuth token |
| `DELETE` | `/api/oauth/disconnect` | Disconnect OAuth |
| `POST` | `/api/token` | Direct token injection |
