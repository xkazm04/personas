# Persona capabilities

What a persona can **do** at runtime. Each capability maps to a
specific column on `personas` or a join table. This doc is the cross-
reference: "if I want behaviour X, which field controls it?"

## The six capability surfaces

```
  Persona
    │
    ├── Tools         — what the persona can CALL (actions)
    ├── Triggers      — how the persona gets INVOKED
    ├── Events        — what the persona REACTS to
    ├── Memory        — what the persona LEARNS
    ├── Reviews       — when the persona asks for APPROVAL
    └── Notifications — how the persona REPORTS outcomes
```

Each surface has a table with a `persona_id` FK and one or more
`persona.*` columns that gate it. This page walks each in turn.

---

## Tools

**Purpose**: the set of actions the persona can perform at runtime.

**Storage**:
- `persona_tool_definitions` — shared catalog (per tool: name,
  category, input/output schema, requires_credential_type,
  implementation_guide)
- `persona_tools` — per-persona assignments with optional
  `tool_config` overrides

**Tool kinds** (resolved by `tool_runner` at execution start):

| Kind | Detection | Execution strategy |
|---|---|---|
| **Script** | `script_path` set and non-empty | `npx tsx {script_path}` with JSON stdin/stdout |
| **API** | `implementation_guide` present (curl template) | Shell-escaped `curl` with `$VAR` substitution from credentials |
| **Automation** | `category == "automation"` and id starts with `auto_` | Routed to `automation_runner` → external platform |
| **Built-in** | `category == "platform"` (messaging, persona_database, …) | Auto-pass during tests; runtime-native |

**Credential binding**:

Each tool definition has `requires_credential_type` (e.g. `"github"`,
`"stripe"`). At execution time, `resolve_credential_env_vars` in
`engine/runner.rs`:

1. Matches tool name → connector.services[].toolName
2. Falls back to `requires_credential_type` → connector name
3. Falls back to `cred_repo::get_by_service_type(...)` — first match
   by service_type

The adoption answer pipeline also records `credential_bindings` so
future work can express "this persona should prefer credential X". See
[templates/07-adoption-answer-pipeline.md](../templates/07-adoption-answer-pipeline.md).

**Run-time controls**:

| Control | Source | Effect |
|---|---|---|
| `persona.max_turns` | Column | Caps agentic-loop iterations (tool calls) per execution. |
| `persona.trust_level` | Column | `Manual` pauses for per-call approval; `Verified` auto-approves; `Revoked` blocks execution. |
| `persona.headless` | Column | `true` bypasses trust-level approval (for automations with no human). |
| `tool_config` | Join | Tool-specific config JSON — e.g. allowed file globs for a file-read tool. |

---

## Triggers

**Purpose**: how a persona gets invoked automatically.

**Storage**: `persona_triggers` table — one row per trigger, any
number per persona. `trigger_type` and `config` define the activation
condition.

**The ten trigger types**:

| Type | Fires when | Config keys |
|---|---|---|
| `manual` | User clicks "Run Now" | `event_type`, `payload` |
| `schedule` | Cron expression matches | `cron`, `interval_seconds`, `event_type`, `payload` |
| `polling` | HTTP GET URL returns changed content | `url`, `headers`, `content_hash`, `interval_seconds` |
| `webhook` | HTTP POST to `/webhook/{trigger_id}` | `webhook_secret`, `event_type`, `payload` |
| `event_listener` | System event bus fires matching type | `listen_event_type`, `source_filter` |
| `chain` | Another persona completes with condition met | `source_persona_id`, `condition`, `event_type` |
| `file_watcher` | Filesystem path changes | `watch_paths[]`, `events[]`, `recursive`, `glob_filter` |
| `clipboard` | Clipboard contents change | `content_type`, `pattern`, `interval_seconds` |
| `app_focus` | App comes to foreground | `app_names[]`, `title_pattern`, `interval_seconds` |
| `composite` | Multiple events within a time window | `conditions[]`, `operator`, `window_seconds` |

**Active window** (any trigger, optional):

```json
{
  "active_window": {
    "enabled": true,
    "days": [1, 2, 3, 4, 5],
    "start_hour": 9, "start_minute": 0,
    "end_hour": 18, "end_minute": 0,
    "timezone": "America/New_York"
  }
}
```

Scheduler skips fires outside the window and returns HTTP 422 with
`Retry-After` for webhooks.

**See** [execution/01-entry-points.md](../execution/01-entry-points.md)
for the full activation semantics per type and how the scheduler loop
actually evaluates them.

---

## Events

**Purpose**: react to system events (credential rotation, other persona
completions, external bus publishes).

Two mechanisms in parallel:

### Event listener triggers (modern)

A `persona_triggers` row with `trigger_type = 'event_listener'`:

```json
{
  "listen_event_type": "deploy_complete",
  "source_filter": "prod-*"     // wildcard on event.source_id
}
```

Registered alongside other triggers; matched in the same event-bus
tick. Can have an active window. Disabling toggles `enabled = 0`.

### Event subscriptions (legacy)

A `persona_event_subscriptions` row:

```sql
persona_id TEXT, event_type TEXT, source_filter TEXT, enabled INT
```

Narrower: no active window, no payload. Kept for older personas. New
work prefers `event_listener` triggers.

### Emission

A persona emits an event via the `emit_event` protocol message in its
output (parsed by `engine/parser.rs`):

```json
{
  "emit_event": {
    "event_type": "deploy_complete",
    "source_type": "persona",
    "source_id": "persona-1",
    "target_persona_id": null,         // null = broadcast, else direct
    "payload": { "deployment_id": "123" },
    "use_case_id": "uc_1"
  }
}
```

Creates a `persona_events` row with status `pending`. The event bus
tick (~1s) claims pending rows, matches against subscriptions +
listeners, and spawns executions.

**See** [execution/03-chaining-and-approval.md](../execution/03-chaining-and-approval.md)
for cascade semantics (chain_trace_id, cascade guards, DLQ handling).

---

## Memory

**Purpose**: let the persona learn from its own runs and carry
knowledge across executions.

**Storage**: `persona_memories`. Extended model adds `tier`
(`core` | `active` | `archive`), `access_count`, `last_accessed_at`.

**Categories** (from `memory.rs` validation):

| Category | Meaning |
|---|---|
| `fact` | Objective knowledge (default) |
| `preference` | User/stakeholder preferences |
| `instruction` | Explicit rules the agent must follow |
| `context` | Background information for reasoning |
| `learned` | Insights derived from past executions |
| `constraint` | Hard limits (rate limits, deadlines, compliance) |

**Importance** (1–5):
- 1: Low — ephemeral detail
- 2: Below average — limited relevance
- 3: Normal (default) — standard operational knowledge
- 4: High — frequently useful context
- 5: Critical — essential for operation

**Injection**: at the start of every execution, `mem_repo::get_for_injection()`
fetches core memories (always injected) plus top active memories
(sorted by importance + recency). They're formatted as markdown
sections `## Agent Memory — Core Beliefs` and `## Agent Memory — Recent
Learnings` and appended to the system prompt.

**Emission**: persona emits memory via:

```json
{
  "agent_memory": [
    { "title": "Learned Pattern", "category": "pattern",
      "content": "...", "importance": 0.8 }
  ]
}
```

Parsed by `engine/parser.rs` → `dispatch.rs` → `mem_repo::create`.

**Lifecycle**: on every execution, `mem_repo::run_lifecycle()`:
- Promotes frequently-accessed active memories to core
- Archives unused core memories after idle period
- Tracks access counts for the lifecycle heuristic

---

## Manual reviews (human approval)

**Purpose**: pause for human approval on sensitive decisions.

**Storage**:
- `persona_manual_reviews` — the review request itself
- `review_messages` — threaded conversation between reviewer and agent

**Flow**:

1. Persona emits `manual_review` protocol message with title,
   description, severity, context_data, suggested_actions.
2. `dispatch.rs` creates the review row with `status = 'pending'`.
3. OS notification fires (desktop) + Tauri event `MANUAL_REVIEW_CREATED`
   emitted to frontend.
4. Reviewer opens the review in the UI, optionally exchanges messages,
   approves/rejects/resolves with notes.
5. `status` transitions: `pending → approved|rejected → resolved`.

**Current model**: the execution does NOT block on review creation —
the persona may continue while the review is pending. Blocking-on-review
support is tracked separately (would require `status = awaiting_approval`
and a session-resume path).

**Trust level interaction**: `persona.trust_level == Manual` means
EVERY tool call emits a review and waits. This is separate from the
explicit `manual_review` protocol that any persona can invoke.
`persona.headless == true` bypasses the trust-level check.

---

## Notifications (outbound)

**Purpose**: deliver outcomes to channels (Slack, email, webhook, SMS,
Teams, Discord, …) so users don't have to check the app.

**Storage**:
- `personas.notification_channels` — **encrypted JSON** array on the
  persona itself (channel configs: type, credentials, target)
- `persona_messages` — the message payload
- `persona_message_deliveries` — per-channel delivery status

**Channel types** (from `channel_type` values):
- `slack` — webhook or bot token
- `email` — SMTP or service
- `webhook` — generic HTTP POST
- `sms` — Twilio, Vonage, etc.
- `teams`, `discord`, `pushover`, …

**Content types**: `text` | `markdown` | `json`

**Priorities**: `low` | `normal` (default) | `high` | `critical` —
channels may respect priority (e.g. skip low-priority emails at night).

**Threading**: `thread_id` groups related messages. The UI shows them
as a conversation (e.g. progress updates for a long-running execution).

**Delivery lifecycle**: `pending → delivered | failed | bounced`.
Each channel tracks its own status; `external_id` stores the Slack
message TS or SMTP message ID for reconciliation.

---

## Automations (external workflows)

**Purpose**: delegate steps to external platforms (n8n, Zapier, GitHub
Actions, custom HTTP workflows) while the persona orchestrates.

**Storage**: `persona_automations` + `automation_runs` (see
[01-data-model.md](01-data-model.md#persona_automations--automation_runs)).

**Injection as virtual tool**:

```rust
// executions.rs line ~165
let mut tools = tool_repo::get_tools_for_persona(...)?;
if let Ok(automations) = automation_repo::get_by_persona(...) {
    for auto in &automations {
        if auto.deployment_status.is_runnable() {
            tools.push(automation_to_virtual_tool(auto));
        }
    }
}
```

The virtual tool carries:
- `name` = automation.name
- `category` = `"automation"`
- `id` = `auto_{automation_id}`
- input/output schemas from the automation

When the persona calls it, `tool_runner` routes to
`automation_runner::execute_automation` which:

1. Resolves the platform credential (n8n API key, GitHub PAT, …)
2. Posts to `webhook_url` with input data
3. Polls `platform_run_id` if the platform is async
4. Returns output or error

**Fallback modes**: if the automation fails, `fallback_mode` controls
what happens:
- `connector` — fall back to the matching connector's native tool (if one exists)
- `fail` — propagate the failure up the agent loop
- `skip` — pretend the call succeeded with a "(skipped)" marker

**Deployment states**: `draft` → `active` ↔ `paused` → `error`. Only
`active` automations get injected as tools.

---

## Cross-surface interactions

These combine across surfaces and are worth knowing:

1. **Tools + credentials**: the credential resolver walks tool names
   and `requires_credential_type` to pick credentials. If no match,
   tool calls fail with "no credentials" — even if the persona's
   `design_context.credentialLinks` specifies one. The link is a hint
   for promotion, not a runtime override yet.

2. **Triggers + events**: a `schedule` trigger can emit a custom
   `event_type` in its config, which other personas can listen to.
   This creates a "heartbeat" pattern: one persona on a cron that
   triggers a fan-out of subscribers.

3. **Memory + reviews**: a reviewer's decision in a `manual_review` is
   a natural source of `learned` memory. The emit_memory + resolve-
   review flow is manual for now; auto-capture would be a small
   engine extension.

4. **Notifications + manual reviews**: a `critical` severity review
   typically drives a high-priority Slack/SMS message via
   `persona_messages`. The persona usually emits both in sequence.

5. **Automations + triggers**: an automation can itself be triggered
   by webhook — bypassing the persona entirely for pure workflow
   steps. Used for "this persona handles intent; those steps are
   deterministic n8n flows".

## Files

| File | Role |
|---|---|
| `src-tauri/src/engine/tool_runner.rs` | Tool kind detection + dispatch (script/API/automation) |
| `src-tauri/src/engine/automation_runner.rs` | External platform invocation |
| `src-tauri/src/engine/prompt.rs` | Prompt assembly with memory + tools + guidance |
| `src-tauri/src/engine/parser.rs` | Protocol message extraction (emit_event, manual_review, …) |
| `src-tauri/src/engine/dispatch.rs` | Turn protocol messages into DB writes |
| `src-tauri/src/engine/bus.rs` | Event bus matching logic |
| `src-tauri/src/engine/scheduler.rs` + `cron.rs` | Trigger scheduling |
| `src-tauri/src/engine/webhook.rs` | Webhook HTTP server (port 9420) |
| `src-tauri/src/db/repos/resources/tools.rs` | Tool CRUD |
| `src-tauri/src/db/repos/resources/triggers.rs` | Trigger CRUD |
| `src-tauri/src/db/repos/communication/events.rs` | Event + subscription CRUD |
| `src-tauri/src/db/repos/resources/memories.rs` | Memory CRUD + lifecycle |
| `src-tauri/src/db/repos/communication/manual_reviews.rs` | Review CRUD |
| `src-tauri/src/db/repos/communication/messages.rs` | Message + delivery CRUD |
| `src-tauri/src/db/repos/resources/automations.rs` | Automation CRUD |
