# 00 — Vision

## The problem with persona-as-process

Today a persona bakes every responsibility into one system prompt. Adding a new
job means either (a) rebuilding the whole persona via CLI, or (b) spawning
another single-purpose persona. Both paths scale poorly:

- **Rebuilding** is expensive, token-hungry, and risks regressing established
  behavior while adding new capabilities.
- **Spawning more personas** creates a swarm of narrow agents that don't share
  memory, identity, or user context. The user loses the "one assistant" mental
  model.

## The mental model we want

A persona is **who** the agent is. Capabilities are **what it can do**.

Example — a "Stock Analyst" persona:

- **Who** (behavior core, stable):
  > You are a disciplined financial analyst. You are direct, data-driven, and
  > skeptical of speculative claims. You always disclose uncertainty. You never
  > provide advice without supporting data.

- **What** (capabilities, composable):
  - Performance analysis for a ticker (triggered manually with a symbol)
  - Weekly gem hunt in a user-chosen sector (scheduled weekly)
  - Government-investment tracker (subscribed to a public filing event)

Each capability can be:

- Enabled or disabled without rebuilding the persona
- Simulated with test fixtures
- Triggered independently (schedule / webhook / event / manual)
- Routed to different notification channels
- Run against a different model profile if latency or cost demands it
- Given its own learned memory (without polluting other capabilities)

The persona's voice, values, and identity remain consistent across every
capability. The user experiences one assistant with many jobs.

## Why this is the right direction

1. **Maintainability.** New capability = new use case (JSON + triggers + test fixture). No LLM rebuild of the whole persona. No risk of regressing unrelated behavior.
2. **User mental model.** One assistant per domain, not a swarm of bots with overlapping concerns.
3. **Shared context.** Core memories, user preferences, and tool access cross-cut all capabilities cleanly — no duplicated state.
4. **Runtime composability.** Enabling/disabling a capability changes the persona's effective behavior without touching stored prompt text.
5. **Observability.** Executions, messages, reviews, and memories tagged per capability give clean analytics — "what did the gem-finder produce this month?" becomes a query, not a scroll through mixed history.
6. **Aligns with Claude's strengths.** LLMs reason well about "I am X, I have these capabilities"; they reason worse about "I am a process that does Y" when the process is actually three unrelated loops.

## What this replaces

The **"persona as n8n workflow"** framing. A persona is not a defined linear
process. It is an assistant with capabilities that each have their own
triggering and delivery, sharing identity and memory.

An n8n workflow, after migration, imports as **one capability within a
persona**, not as a standalone persona. Multiple workflows against the same
domain become multiple capabilities of the same persona.

## What we preserve

- Prompts and structured prompts are still the primary source of truth for
  execution behavior. We layer capabilities on top; we do not replace prompts.
- Tools, credentials, triggers, memories, and events all keep their existing
  schemas — we add `use_case_id` attribution where it was missing and make
  the runtime actually honor it.
- The build session CLI still produces the initial persona; we extend its
  output (AgentIr) to carry per-capability attribution semantically rather
  than positionally.
- Templates stay as the onboarding surface; their **internal shape** changes,
  but the adoption flow and the catalog UI stay recognizable.

## Non-goals (explicit)

- We are **not** making capabilities execute in isolation from the persona.
  Every capability run goes through the persona's system prompt, tools, core
  memories, and governance. Capabilities are behavioral scopes inside one
  persona, not sub-personas.
- We are **not** introducing a DAG composition model. Capabilities can
  communicate via events (A emits → B subscribes), same as today, but there
  is no first-class "flow A feeds flow B with structured output" pipeline.
  That may come later (see [10-deferred-backlog.md](10-deferred-backlog.md)).
- We are **not** making tools capability-scoped in the first pass. All
  persona tools remain available to every capability; capability descriptions
  carry *hints* about which tools are most relevant. Per-capability tool
  restriction is deferred.
- We are **not** redesigning Chat or the Lab to be per-capability in the
  initial rollout. The CLI routes requests to the right capability context
  internally; the user doesn't pick.
