# 10 — Deferred Backlog

> Items intentionally deferred from C1–C6. Each has a **trigger condition**
> — the signal that says "now is the time." When the trigger fires, lift
> the item out of this doc, spec it, plan it, ship it.

## §A — Stale-prompt lint / warning

**What.** When a capability is disabled but the persona's baked
`structured_prompt.instructions` still references it by name, surface a
warning in the Design hub header with a one-click "regenerate prompt"
action.

**Why deferred.** We trust the live "Active Capabilities" section as source
of truth; the model treats it as authoritative. Drift is a nuisance, not a
correctness bug.

**Trigger to revisit.**

- Real users report persona behavior confusion traceable to stale references.
- OR: telemetry shows capability toggles are frequent and users regenerate
  prompts manually often enough that an automation would help.

## §B — Per-capability tool subsetting

**What.** Add `use_case_id` to `persona_tools` (or a link table), and allow
tools to be scoped to specific capabilities. Runtime filters the tool array
passed to Claude per capability.

**Why deferred.** The Active Capabilities section already includes
`tool_hints` so the model knows which tools are most relevant per capability.
Hard restriction adds complexity without clear value unless we observe
tools being misused cross-capability.

**Trigger to revisit.**

- Cost/token pressure: too many tool schemas sent per execution.
- Safety: a capability is misusing a tool it shouldn't have access to.
- User explicitly requests scoping during Design hub interactions.

## §C — Orphan cleanup UI for historical records

**What.** When a capability is removed from `design_context.useCases`,
historical `persona_executions`, `persona_messages`, `persona_manual_reviews`,
`persona_memories` rows retain their now-unknown `use_case_id`. Admin-mode
UI to reattribute these to a surviving capability or purge them.

**Why deferred.** Greenfield — no capabilities removed from production
personas yet. Data stays queryable by the defunct ID; UI just shows
"unknown capability."

**Trigger to revisit.**

- First support ticket about confusing "unknown capability" entries.
- OR: before first external beta, to avoid embarrassing state.

## §D — Capability composition graph / map view

**What.** A read-only graph visualization of capabilities as nodes, with
edges inferred from event subscriptions (capability A emits event X,
capability B subscribes to X → edge A → B). Reuses patterns from
`DependencyGraphPanel` in `sub_connectors`.

**Why deferred.** List view is sufficient for mental model. A graph adds
value only when personas have 5+ interlinked capabilities.

**Trigger to revisit.**

- A persona in the wild has 5+ capabilities with genuine event-driven composition.
- User research shows the list view is hiding coupling that causes surprise behavior.

## §E — "Focus this chat on capability X" affordance

**What.** A selector in the Chat UI that pins the current conversation to a
specific capability. The chat pinning injects `_use_case` into every chat
turn's `input_data`, scoping response style, tool hints, and notification
routing.

**Why deferred.** Chat is deliberately left persona-wide so the LLM can
route internally. Most chats span multiple capabilities.

**Trigger to revisit.**

- Users complain that chat "drifts" between capability contexts when they
  want one specific scope.

## §F — Cross-persona capability overview

**What.** An Overview-level page listing all capabilities across all
personas (filter by category, enable state, trigger type, last executed).
Makes the capability set a browsable unit of organization across the whole
app.

**Why deferred.** Persona-level organization is sufficient until the user
has many personas. Adding a cross-persona view before that clutters the
information architecture.

**Trigger to revisit.**

- User has >10 personas with ≥30 capabilities total.
- OR: explicit user request for "show me everything my agents can do."

## §G — Capability-local prompt overrides (structured_prompt fragments)

**What.** Each capability can declare its own prompt fragments that
override persona-wide fields for that capability only. E.g., "for Gem
Finder specifically, use this errorHandling strategy." Stored in
`DesignUseCase.per_capability_prompt_overrides`.

**Why deferred.** Option A assumes capability_summary + tool_hints +
model_override is enough. If usage shows a consistent need for deeper
prompt overrides, add this.

**Trigger to revisit.**

- Lab C6 refinement patterns consistently produce fragments that are
  capability-specific.
- User feedback indicates "the persona is too generic when running X, I want
  it to think differently."

## §H — n8n workflow → single capability (instead of persona)

**What.** `import_n8n_workflow(persona_id, use_case_id, workflow_json)` —
import an n8n workflow as one capability within an existing persona, rather
than always as a new persona.

**Why deferred.** Current flow (one workflow = one persona) works for first
users. The per-capability path needs the AgentIr v2 schema stable first (C2).

**Trigger to revisit.**

- After C2 ships.
- First user with multiple related n8n workflows that should be one persona.

## §I — Test fixtures cross-referenced from Lab scenarios

**What.** A capability's `test_fixtures` feed directly into Lab's scenario
test runner, so "run Lab against capability X's fixtures" is a one-click
action instead of manual JSON copy-paste.

**Why deferred.** Separate scenarios already exist in Lab; unifying requires
C5 (use_case_id on executions) plus C6 (Lab scope awareness) to be done first.

**Trigger to revisit.**

- After C6 ships.
- Users manually wiring fixtures into Lab scenarios frequently.

## §J — Budget / turn limits per capability

**What.** Allow `max_budget_usd` and `max_turns` overrides on a capability,
so a cheap classification capability can be budget-capped separately from a
deep analysis one.

**Why deferred.** Persona-level governance is sufficient for MVP. Complexity
of merging persona + capability caps (which wins? both? min of the two?)
isn't worth solving until we hear from users.

**Trigger to revisit.**

- A persona has a mix of cheap + expensive capabilities and the user is
  worried about a runaway on the expensive one.

## How to promote an item out of this backlog

1. Confirm the trigger condition has fired.
2. Write a short RFC under `docs/concepts/persona-capabilities/rfc-<name>.md`:
   - What's changing
   - Why now (trigger evidence)
   - Schema/API/UI impact
   - Phases
3. Open a planning discussion (Slack thread, sync meeting).
4. Convert to a phase in [09-implementation-plan.md](09-implementation-plan.md).
5. Remove or annotate the item here ("Promoted to Phase CX, YYYY-MM-DD").

## Items **not** in this backlog

Things we explicitly rejected from scope, not just deferred:

- **Capabilities as sub-personas with independent identities.** We are not
  fragmenting identity; see [00-vision.md](00-vision.md) non-goals.
- **DAG composition between capabilities.** Event subscriptions are the
  composition primitive.
- **Capability-per-organization / multi-tenant capability registry.** Out of
  scope for the local-first model.
