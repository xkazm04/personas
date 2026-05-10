# Agent Operations Hub

> Migrated from `docs/concepts/agent-operations-hub.md` on 2026-05-10. Phase 1 (chat ops dispatch + sidebar panels) is **shipped**; Phase 2 sidebar consolidation and Phase 3 assertions-into-lab integration tracked under Future work below.

The agent editor's Chat tab is the persona's **operations hub** — a chat surface where the user (or the operations assistant) drives execution, health checks, lab tests, prompt edits, tool assignment, and assertion management without leaving the conversation. Lab, Health, Design, and Assertions remain available as overflow tabs but are no longer the primary path.

## User surface

The Chat tab in the persona editor (`src/features/agents/sub_chat/`) hosts the hub:

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Operations Assistant | Default session type — assistant has full control over the persona (edit prompts/tools/settings, run health, start lab tests, manage assertions, execute the persona, read history, diagnose) | `ChatTab.tsx`, `libs/chatOpsPrompt.ts`, `libs/chatOpsDispatch.ts` |
| Agent Chat (legacy) | Toggle to talk *to* the persona instead of *about* it. Session type stored in `chat_sessions.session_type` | Same surfaces, alternate system prompt |
| Inline results | Health score cards, arena result tables, execution output preview, assertion pass/fail badges rendered as part of the chat thread | `ChatBubbles.tsx` |
| Launchpads | `AdvisoryLaunchpad`, `OpsLaunchpad` — structured-prompt entry points for common operations | `AdvisoryLaunchpad.tsx`, `OpsLaunchpad.tsx` |

## How the assistant takes action

The Operations Assistant emits structured operation calls; `chatOpsDispatch.ts` parses them and routes to backend commands.

| Operation | Backend |
| --- | --- |
| `{"op":"health_check"}` | `test_design_feasibility` — returns score + issues inline |
| `{"op":"execute","input":"…"}` | `execute_persona` — runs the persona, streams output |
| `{"op":"dry_run","scenario":"…"}` | `execute_persona` with sandbox |
| `{"op":"arena","models":[…]}` | `lab_start_arena` |
| `{"op":"matrix","instruction":"…"}` | `lab_start_matrix` — generates a draft prompt |
| `{"op":"edit_prompt","section":"…","content":"…"}` | `update_persona` |
| `{"op":"add_tool","name":"…"}` | `assign_tool` (see [automation-tools.md](../automation-tools.md)) |
| `{"op":"create_assertion","name":"…","type":"regex","config":{…}}` | `create_output_assertion` |
| `{"op":"list_executions","limit":5}` | `list_executions` |
| `{"op":"assertion_results","execution_id":"…"}` | `get_assertion_results` |
| `{"op":"apply_fix","fix_type":"…","target":"…"}` | Various — one-click fixes from health-check results |

## Context injection

Every chat turn injects the current persona state as a structured preamble (similar to CLAUDE.md but auto-generated):

```
## Current Persona State
- Name: {name}
- Tools: {tool_list}
- Last execution: {status} at {time} (cost: ${cost})
- Health score: {score}/100 ({issue_count} issues)
- Active assertions: {count} ({failing_count} failing)
- Recent arena: {status} — avg scores: tool={ta}, quality={oq}, protocol={pc}
```

The assistant therefore answers questions like "is this persona healthy?" or "what's failing?" without round-tripping additional reads.

## Backend wiring

| File | Concern |
| --- | --- |
| `src-tauri/src/engine/prompt.rs` | `assemble_ops_prompt()` builds the operations-assistant system prompt with persona context |
| `src-tauri/src/commands/execution/executions.rs` | `execute_chat_ops` routes parsed operation calls to the appropriate handlers |
| Existing handlers | Reused — operations are thin orchestration over `update_persona`, `execute_persona`, `lab_start_*`, `create_output_assertion`, `assign_tool`, `list_executions`, `get_assertion_results` |

## Status of consolidated modules

| Tab | Status |
| --- | --- |
| Use Cases / Prompt / Connectors / Settings | Primary tab bar |
| **Chat (Ops)** | Primary tab bar — the hub |
| Lab / Health / Assertions | Overflow tabs (still accessible directly); compact equivalents available as sidebar panels in the hub (see Future work) |
| Design | Legacy overflow — kept available, receives no new investment (PersonaMatrix handles creation now) |

## Future work

These pieces of the original concept are not yet shipped:

### Phase 2 — Sidebar panels in the hub

Compact versions of Lab/Health/Assertions/Run as a collapsible left sidebar inside the Ops tab, with chat ↔ panel cross-references ("I've started an arena test — check the Lab panel for progress" with a clickable link). The full tabs remain in the overflow as the long-form view; the panels are the at-a-glance view inside chat.

### Phase 3 — Auto-run assertions on lab results

After each lab scenario executes (`engine/test_runner.rs::score_result`), run all active assertions against the output, store results in `assertion_results` linked to the lab result id, and surface pass/fail badges inline in arena/matrix result views.

## Key decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Assistant control level | Full control | Chat becomes THE management interface; anything the user can do via tabs, the assistant can do via chat |
| Design module future | Keep as legacy | PersonaMatrix handles creation; Design stays accessible but receives no new investment |
| Agent chat mode | Keep as toggle | Some users want to talk *to* the agent; keep both modes available via session type toggle |
