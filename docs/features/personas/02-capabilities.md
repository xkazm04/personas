# Persona capabilities

What a persona can **do** at runtime. Each capability maps to a
specific column on `personas` or a join table. This doc is the cross-
reference: "if I want behaviour X, which field controls it?"

## The capability surfaces

```
  Persona
    │
    ├── Tools         — what the persona can CALL (actions)
    ├── Triggers      — how the persona gets WOKEN from outside (events, clocks, webhooks)
    ├── Attention     — how the persona spends its OWN initiative (the attention loop)
    ├── Events        — what the persona REACTS to
    ├── Memory        — what the persona LEARNS
    ├── Reviews       — when the persona asks for APPROVAL
    └── Notifications — how the persona REPORTS outcomes
```

Each surface has a table with a `persona_id` FK and one or more
`persona.*` columns that gate it. This page walks each in turn, then
describes [the assembled prompt](#the-assembled-prompt) that stitches
the living-agent pieces (Core, charters, episodes, memory) into every
execution.

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

**Purpose**: how a persona gets invoked automatically. In the
living-agent frame, triggers are the persona's **wake sources from the
outside world** — a clock, an event, a webhook, a file change decides
it is time to run. The [attention loop](#the-attention-loop) below is
the complementary entry point: the persona's own initiative, on its
charters' cadence. The two are deliberately kept apart — an
attention-dispatched execution never carries a `trigger_id`, so it can
never advance a trigger's schedule.

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

## The attention loop

**Purpose**: let a persona act on its charters without an external
trigger — check what it owns, follow up on what it missed, keep its
memory consolidated, and occasionally improve its own craft.

**Default OFF.** The loop is gated by the global settings key
`autonomous_attention_loop` (`AUTONOMOUS_ATTENTION_LOOP` in
`src-tauri/db/src/settings_keys.rs`, default `false`; an absent key is
off). It is an autonomy `Action::AttentionLoop` with required scope
rung 2, so a mandate check rides on top of the switch.

**Where it lives**: `AttentionSubscription` in
`src-tauri/src/engine/subscription/attention.rs` — a standard
`ReactiveSubscription` (300 s active interval, 900 s idle, 120 s
initial delay), registered in `engine/background/lifecycle.rs`. The
work list is `responsibilities::list_active_with_attention`: active
charters whose `cadence.attention_enabled` is true, on enabled
personas.

**Admission ladder** — before any work is chosen, each candidate
persona climbs five checks; the first refusal wins and is **typed**
(`AttentionRefusal` in `src-tauri/core/src/cycle.rs`, serialized with
a stable `kind` tag):

| # | Check | Refusal kind |
|---|---|---|
| 1 | an open ledger row younger than 30 min | `in_flight` |
| 2 | minutes since last completed pass < the charters' max `interval_minutes` (default 30) | `interval_floor` |
| 3 | inside any charter's `quiet_hours` window (`"HH:MM-HH:MM"`, wrap-aware) | `quiet_hours` |
| 4 | today's runs ≥ the charters' min `max_runs_per_day` (default 24) | `daily_cap_reached` |
| 5 | monthly spend ≥ `persona.max_budget_usd` (when set > 0) — the same `get_monthly_spend` pair the execution pre-flight uses, checked here so the ledger refuses loudly instead of the spawn failing validation | `budget_exhausted` |

Refusals are written to `persona_attention_ledger` as terminal
`refused` rows carrying the serialized refusal — deduplicated (same
kind, same day, work still pending), so the ledger stays a story, not
a heartbeat log. A persona with nothing to do writes nothing.

**Lanes** — for an admitted persona, `choose_lane` picks ONE lane per
tick, in priority order:

1. **`arrivals`** — an unanswered team-channel message addressed to
   the persona, at least 10 minutes old (younger messages are still
   owned by the live reply path; re-dispatch is idempotent by key).
2. **`maintenance`** — the sleep-cycle consolidation is due
   (`sleep_cycle::admit`): enqueues a consolidation job, DB-only.
3. **`improve`** — once per day (`count_today(lane='improve') == 0`):
   a self-improvement pass on the persona's own craft. Deliberately
   ranked above `advance`, otherwise it would be unreachable.
4. **`advance`** — push the least-recently-advanced charter's
   objectives forward (never-advanced charters first).

Every dispatched brief embeds the `ATTENTION_GUARDRAILS` preamble
("PROPOSE, never restructure", "NEVER touch your own gates", "stay
inside the scope rung named above", "NOBODY IS THERE") and restates
the charter's scope rung and refusal classes. The dispatch envelope is
`{"source": "attention", "_attention": {ledgerId, responsibilityId,
lane}, "task": …}` with a per-decision idempotency key and — by
design — **no `trigger_id`**.

Every pass, refusal, dispatch outcome and consolidation run lands in
`persona_attention_ledger` (schema in
[01-data-model.md](01-data-model.md#persona_attention_ledger));
verdicts run `started → dispatched | enqueued | acted | noop | refused
| failed`. The Design hub's Responsibilities sub-tab, the Mission Control
attention-loop tile (which also holds the loop's global toggle), and the
Activity feed read this ledger.

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
(`core` | `active` | `working` | `archive`), `access_count`,
`last_accessed_at`, and — since the living-agent rebase — `fact_key`
(the stable identity of a consolidated fact; see
[01-data-model.md](01-data-model.md#persona_memories)).

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

Consolidation-written facts are clamped to 2–4 by the write door — an
agent cannot mint its own `critical` memory (see
[03-trust-and-governance.md](03-trust-and-governance.md#the-write-lane-law)).

**Injection**: at the start of every execution,
`mem_repo::get_for_injection_v2()` fetches core memories (always
injected) plus top active/working memories (sorted by importance +
recency; the archive tier is excluded). They're formatted as markdown
sections `## Agent Memory — Core Beliefs` and `## Agent Memory —
Recent Learnings` and appended to the system prompt.

**Two write paths**:

1. **Protocol emission** (during a run) — the persona emits:

```json
{
  "agent_memory": [
    { "title": "Learned Pattern", "category": "pattern",
      "content": "...", "importance": 0.8 }
  ]
}
```

Parsed by `engine/parser.rs` → `dispatch.rs` → `mem_repo::create`.

2. **Consolidation** (between runs) — the sleep cycle
   (`src-tauri/src/engine/persona_brain/sleep_cycle.rs`) distills
   recent episodes into durable facts through the single governed door
   `create_consolidated`: tier forced to `working`, importance clamped
   2–4, mandatory episode provenance, tombstone check first. Details
   in [03-trust-and-governance.md](03-trust-and-governance.md#the-write-lane-law).

**Lifecycle**: on every execution, `mem_repo::run_lifecycle()`:
- Promotes frequently-accessed memories up the tiers
- Archives unused memories after an idle period
- Tracks access counts for the lifecycle heuristic

A curator can also **forget** a fact permanently: the tombstone
(`persona_memory_tombstone`) bars consolidation from ever re-deriving
it from old episodes.

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

A cousin of this surface carries the living-agent **self-model diffs**:
a `persona_memory_review_proposal` row of kind `self_model_diff` is a
"please-approve-this-identity-edit" request, applied only on operator
approval (see
[03-trust-and-governance.md](03-trust-and-governance.md#the-write-lane-law)).

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

## The assembled prompt

Every execution's system prompt is assembled in
`src-tauri/engine/src/prompt/assemble.rs`
(`assemble_prompt_with_skills` is the full-arity entry; section
renderers in `prompt/core_section.rs`). Since the living-agent rebase
the assembler renders three sections that make the persona a WHO
before a HOW:

| Section | Content | Source |
|---|---|---|
| `## Core` | The rendered `PersonaCore` — identity, voice, the 7 dials, principles, constraints, decision principles. Placed immediately before the `## Identity` branch ("WHO before HOW"); when the Core carries its own `identity`, the structured prompt's identity subsection is skipped so the two never fight. | `persona.core_profile`, parsed once; a corrupt Core warns and skips — it can never fail assembly |
| `## Responsibilities` | Up to 3 active charters (then "+N more"): domain, outcomes with success criteria, the scope-rung line ("never merge, deploy, or change your own gates"), refusal classes as refuse-and-escalate prose, the monthly budget line | `resp_repo::list_by_persona` filtered to `active`, loaded best-effort by `runner::load_living_prompt_inputs` |
| `## Recent Episodes (oldest first)` | The last 8 episodes, **reversed to oldest-first** so the story reads forward; body nonce-fenced, the heading and framing sentence deliberately outside the fence | `episode_repo::list_recent` (newest-first, then `.rev()`) |

Alongside them the assembler keeps the pre-living pieces: the
structured-prompt subsections (identity/instructions/toolGuidance/…),
tool guidance, and the memory sections (`## Agent Memory — Core
Beliefs`, `## Agent Memory — Recent Learnings`).

The living inputs are **best-effort**: a failed charter or episode
read warns and degrades to an empty section — a broken brain must
never block an execution. They are skipped on session resume (the
session already carries its context). Per-section size tripwires
(`prompt/budget.rs`: Core 8k chars, Responsibilities 8k, Episodes 12k,
total 200k) log overruns for observability but never truncate.

A Core edit invalidates warm prepared-run caches — the Core is hashed
into the cache key (`prepared_run_cache.rs`), and
`core_fingerprint` travels with the execution record.

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

3. **Attention + channels**: the arrivals lane is a recovery net —
   a team-channel message the live reply path never answered gets
   re-dispatched by the attention loop through the same door, with
   the same idempotency key, so double-delivery is structurally safe.

4. **Attention + memory**: the maintenance lane is how consolidation
   actually gets scheduled day-to-day — the loop probes
   `sleep_cycle::admit` and enqueues the consolidation job when due.

5. **Memory + reviews**: a reviewer's decision in a `manual_review` is
   a natural source of `learned` memory. The emit_memory + resolve-
   review flow is manual for now; auto-capture would be a small
   engine extension.

6. **Notifications + manual reviews**: a `critical` severity review
   typically drives a high-priority Slack/SMS message via
   `persona_messages`. The persona usually emits both in sequence.

7. **Automations + triggers**: an automation can itself be triggered
   by webhook — bypassing the persona entirely for pure workflow
   steps. Used for "this persona handles intent; those steps are
   deterministic n8n flows".

## Files

| File | Role |
|---|---|
| `src-tauri/src/engine/tool_runner.rs` | Tool kind detection + dispatch (script/API/automation) |
| `src-tauri/src/engine/automation_runner.rs` | External platform invocation |
| `src-tauri/engine/src/prompt/assemble.rs` | Prompt assembly (Core / Responsibilities / Episodes / memory / tools) |
| `src-tauri/engine/src/prompt/core_section.rs` | `render_core` + `render_responsibilities` |
| `src-tauri/src/engine/subscription/attention.rs` | The attention loop (lanes, admission ladder, guardrails) |
| `src-tauri/src/engine/persona_brain/sleep_cycle.rs` | Consolidation loop (maintenance lane's target) |
| `src-tauri/engine/src/parser.rs` | Protocol message extraction (emit_event, manual_review, …) |
| `src-tauri/src/engine/dispatch.rs` | Turn protocol messages into DB writes |
| `src-tauri/engine/src/bus.rs` | Event bus matching logic |
| `src-tauri/src/engine/background/scheduler.rs` + `src-tauri/core/src/cron.rs` | Trigger scheduling |
| `src-tauri/src/engine/webhook.rs` | Webhook HTTP server (port 9420) |
| `src-tauri/db/src/repos/resources/tools.rs` | Tool CRUD |
| `src-tauri/db/src/repos/resources/triggers.rs` | Trigger CRUD |
| `src-tauri/db/src/repos/communication/events.rs` | Event + subscription CRUD |
| `src-tauri/db/src/repos/core/memories.rs` | Memory CRUD + lifecycle + `create_consolidated` |
| `src-tauri/db/src/repos/core/attention_ledger.rs` | Attention/consolidation ledger |
| `src-tauri/db/src/repos/communication/manual_reviews.rs` | Review CRUD |
| `src-tauri/db/src/repos/communication/reports.rs` | Message + delivery CRUD |
| `src-tauri/db/src/repos/resources/automations.rs` | Automation CRUD |
