# 01 — Behavior Core

> This is the design artifact the previous session requested. It defines what
> belongs to the persona itself (stable across all capabilities) vs what moves
> to individual capabilities.

## Principle

A field belongs to the **behavior core** if it is true about the persona
regardless of which capability is executing. A field belongs to a **capability**
if it is specific to a single job the persona performs.

## What the behavior core contains

### 1. Identity

| Field | Source | Notes |
|---|---|---|
| `name` | `personas.name` | Human-visible identity |
| `description` | `personas.description` | One-line purpose summary |
| `icon`, `color` | `personas.icon`, `personas.color` | Visual identity |
| `role_statement` | New: `structured_prompt.identity.role` | "You are a financial analyst." One sentence. |

### 2. Voice & style

These describe *how* the persona communicates, independent of what it's doing.

| Field | Source | Notes |
|---|---|---|
| `voice` | New: `structured_prompt.voice` | "Direct, data-driven, skeptical of speculation." |
| `tone_adjustments` | New: `structured_prompt.voice.tone_adjustments[]` | Per-notification-channel tone overrides (formal for email, casual for Slack) — optional |
| `output_format_preferences` | New: `structured_prompt.voice.output_format` | "Lead with the bottom line. Use bullet lists for options. Include data tables when comparing." |

### 3. Principles & constraints

Cross-cutting rules the persona always honors.

| Field | Source | Notes |
|---|---|---|
| `principles[]` | New: `structured_prompt.principles[]` | Free-text principles: "Never give financial advice without disclaimers." "Prefer primary sources over secondary." |
| `constraints[]` | New: `structured_prompt.constraints[]` | Hard limits: "Do not purchase anything on behalf of the user." "Never call an API that costs over $0.10 per invocation without asking." |
| `error_handling` | Existing `structured_prompt.errorHandling` | How the persona reacts to failures |
| `communication_protocols` | Existing — how to emit messages/events/memories | Cross-cutting |

### 4. Cognitive style

How the persona thinks, not what it thinks about.

| Field | Source | Notes |
|---|---|---|
| `execution_discipline` | `personas.parameters[execution_discipline]` | `autonomous` \| `deliberate` — existing, stays persona-level |
| `decision_principles[]` | New: `structured_prompt.decision_principles[]` | "When two sources disagree, prefer the primary one." "If confidence < 70%, flag it explicitly." |
| `verbosity_default` | New: `structured_prompt.verbosity_default` | `terse` \| `normal` \| `verbose` — starting point, capabilities may override |

### 5. Shared state

| Field | Source | Notes |
|---|---|---|
| `core_memories` | `persona_memories` where `tier='core'` and `use_case_id IS NULL` | Facts, constraints, user preferences that apply everywhere |
| `structured_prompt` baseline | `personas.structured_prompt` | The text bundle that captures 1–4 above |
| `tools` | `persona_tools` join | Full tool pool, shared across capabilities |
| `notification_channels` (persona-wide fallback) | `personas.notification_channels` | Default delivery if a capability doesn't specify its own |

### 6. Governance & operational limits

| Field | Source | Notes |
|---|---|---|
| `trust_level`, `trust_origin`, `trust_score` | `personas.*` | Approval gating, always persona-level |
| `sensitive`, `headless` | `personas.*` | Regulatory/safety flags |
| `max_concurrent` | `personas.max_concurrent` | Concurrency cap for the persona as a whole |
| `max_budget_usd` | `personas.max_budget_usd` | Monthly spend ceiling (persona-level; capabilities inherit) |
| `max_turns` | `personas.max_turns` | Per-execution agentic-loop cap |
| `gateway_exposure` | `personas.gateway_exposure` | `local_only` \| `invite_only` \| `public` |
| `timeout_ms` | `personas.timeout_ms` | Default execution timeout (capabilities may override later) |

## What is NOT in the behavior core

These move to the individual capability (use case):

- Specific triggers (cron, polling, webhooks, event subscriptions)
- Specific input schemas and sample inputs
- Per-capability notification routing (which Slack channel / email list)
- Model profile override (a capability may use Haiku for cheap classification, Opus for deep analysis)
- Learned memories derived from that capability's executions
- Test fixtures for simulating that capability
- Enabled/disabled runtime state
- Time-window filters (e.g., "last 7 days" scoping)
- Any `examples` that are specific to one capability

## Structured prompt shape (v2)

The current `structured_prompt` schema has fields: `identity`, `instructions`,
`toolGuidance`, `examples`, `errorHandling`, `webSearch`, `customSections`.

The new shape (additive — existing fields remain valid):

```jsonc
{
  "identity": {
    "role": "Disciplined financial analyst",
    "description": "Helps users make sound investment decisions without speculating."
  },
  "voice": {
    "style": "Direct, data-driven, skeptical of speculation",
    "output_format": "Lead with the bottom line. Bullet lists for options. Data tables for comparisons.",
    "tone_adjustments": [
      { "channel": "email", "tone": "formal" },
      { "channel": "slack", "tone": "concise and casual" }
    ]
  },
  "principles": [
    "Never give investment advice without disclosing uncertainty.",
    "Prefer primary sources (filings, exchange data) over secondary (news takes).",
    "If data is older than 24h, flag it."
  ],
  "constraints": [
    "Do not execute trades on behalf of the user.",
    "Never spend more than $0.50 per execution without explicit approval."
  ],
  "decision_principles": [
    "When two sources conflict, prefer the primary one and note the conflict.",
    "Below 70% confidence, say 'uncertain' rather than hedging."
  ],
  "instructions": "You operate across multiple capabilities. Each run will be scoped to one capability with its own purpose. Focus on delivering that capability's outcome; draw on your principles and data discipline consistently.",
  "toolGuidance": "Prefer real-time data APIs for price/news. Use the screener for broad searches. Cite sources using emit_message structured blocks.",
  "examples": [],
  "errorHandling": "On tool error, retry once with backoff. If repeated, emit a manual_review request with the full error context.",
  "communicationProtocols": "Every substantive finding -> emit_message. Every learned preference or fact about the user -> emit_memory. Every finding requiring human judgment -> request_review.",
  "customSections": {},
  "verbosity_default": "normal"
}
```

The runtime prompt assembler renders these sections in order. The new fields
(`voice`, `principles`, `constraints`, `decision_principles`, `verbosity_default`)
are added to `structured_prompt` rendering in `src-tauri/src/engine/prompt.rs`
alongside the existing section renderers.

## Core memory vs learned memory

- **Core memory** (`tier = 'core'`, `use_case_id IS NULL`): always injected
  into every execution. Examples: "User lives in EU timezone." "User prefers
  metric units." "User's risk tolerance is moderate."

- **Learned memory** (`tier = 'active'` or `'archive'`, `use_case_id IS NOT NULL`):
  injected only when executing that specific capability. Examples (gem finder):
  "User's initial screen excludes micro-caps." "User dislikes energy sector."
  (performance analysis): "User tracks NVDA, AAPL, MSFT daily."

This is how two capabilities learn different things about the same user
without cross-polluting each other, while still sharing the "this user exists,
here's who they are" core context.

## Migration note

Existing `structured_prompt` schemas that only have `identity` + `instructions`
+ the legacy fields remain valid. The new fields are optional. The prompt
assembler treats missing new fields as "not specified" and renders nothing for
them. Template-level migration (see [06-building-pipeline.md](06-building-pipeline.md))
will populate the new fields for all templates in one pass.

## What the CLI-based persona builder needs to learn

The CLI (`src-tauri/src/engine/build_session.rs`, `src-tauri/src/engine/cli_prompt.rs`)
currently asks the LLM to produce one global `system_prompt` + `structured_prompt`.
Post-migration it will instead ask for:

1. The behavior core (fields above) — **stable**, rarely rebuilt.
2. A list of capabilities with each capability's triggers/events/inputs/channels/model.
3. A persona-wide instruction that explicitly **introduces** the capabilities
   so the runtime injection reads naturally.

The CLI prompt changes are covered in [06-building-pipeline.md](06-building-pipeline.md).
