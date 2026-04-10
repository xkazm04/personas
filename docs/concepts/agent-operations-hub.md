# Agent Operations Hub — Solution Design

## Context

The agent editor has 5 quality/operations modules (Chat, Lab, Health, Design, Assertions) that work independently but lack cohesion. The user interacts with each via separate tabs, with no unified interface to manage persona health, testing, and improvement.

**Decision**: Transform Chat into a full-control Operations Assistant. Design stays as legacy. Lab/Health/Assertions become sidebar tools the assistant orchestrates.

---

## Architecture

```
Agent Editor Layout (after consolidation)
==========================================

  +---------+-------------------------------------+
  | Sidebar |  Chat (Operations Assistant)        |
  |         |                                     |
  | [Run]   |  Assistant has full control:        |
  |  Execute|  - Edit prompts, tools, settings    |
  |  Dry-run|  - Run health checks                |
  |         |  - Start lab tests (arena/matrix)   |
  | [Lab]   |  - Create/manage assertions         |
  |  Arena  |  - Execute persona                  |
  |  Matrix |  - Read execution history           |
  |  Eval   |  - Diagnose issues                  |
  |  History|                                     |
  |         |  Inline results:                    |
  | [Health]|  - Health score cards               |
  |  Score  |  - Arena result tables              |
  |  Issues |  - Execution output preview         |
  |  Fixes  |  - Assertion pass/fail badges       |
  |         |                                     |
  | [Assert]|  +--------------------------+       |
  |  Rules  |  | [input]           [Send] |       |
  |  Results|  +--------------------------+       |
  +---------+-------------------------------------+

  Tabs: Use Cases | Prompt | Connectors | Settings
        (Lab | Health | Design | Assertions — overflow)
```

## Phase 1: Chat -> Operations Assistant

### 1.1 System Prompt Replacement

Replace the current chat system prompt (which makes the assistant act AS the persona) with an Operations Assistant prompt that has:

- **Identity**: "You are a persona operations assistant. You manage, test, and improve the agent named {persona.name}."
- **Context**: Full persona config (structured_prompt, tools, connectors, recent executions, health status, assertions)
- **Capabilities**: List of available operations the assistant can perform
- **Protocol**: Use function-call-style JSON to trigger operations

### 1.2 Operations the Assistant Can Perform

| Operation | Trigger | Backend | Effect |
|-----------|---------|---------|--------|
| Run Health Check | `{"op": "health_check"}` | `test_design_feasibility` | Returns score + issues inline |
| Execute Persona | `{"op": "execute", "input": "..."}` | `execute_persona` | Runs persona, streams output |
| Dry Run (no side effects) | `{"op": "dry_run", "scenario": "..."}` | `execute_persona` with sandbox | Simulated execution |
| Start Arena Test | `{"op": "arena", "models": [...]}` | `lab_start_arena` | Starts arena, reports results |
| Start Matrix Improvement | `{"op": "matrix", "instruction": "..."}` | `lab_start_matrix` | Generates draft prompt |
| Edit Prompt Section | `{"op": "edit_prompt", "section": "instructions", "content": "..."}` | `update_persona` | Direct prompt edit |
| Add Tool | `{"op": "add_tool", "name": "web_search"}` | `assign_tool` | Links tool to persona |
| Create Assertion | `{"op": "create_assertion", "name": "...", "type": "regex", "config": {...}}` | `create_output_assertion` | Adds guardrail |
| List Executions | `{"op": "list_executions", "limit": 5}` | `list_executions` | Shows recent runs |
| Show Assertion Results | `{"op": "assertion_results", "execution_id": "..."}` | `get_assertion_results` | Pass/fail details |
| Apply Health Fix | `{"op": "apply_fix", "fix_type": "...", "target": "..."}` | Various | One-click fix |

### 1.3 Context Injection

On each chat turn, inject current persona state as context (like CLAUDE.md):

```
## Current Persona State
- Name: {name}
- Tools: {tool_list}
- Last execution: {status} at {time} (cost: ${cost})
- Health score: {score}/100 ({issue_count} issues)
- Active assertions: {count} ({failing_count} failing)
- Recent arena: {status} — avg scores: tool={ta}, quality={oq}, protocol={pc}
```

### 1.4 Implementation Files

| File | Change |
|------|--------|
| `src/features/agents/sub_chat/ChatTab.tsx` | Add sidebar panel slots, change system prompt |
| `src/features/agents/sub_chat/libs/chatOpsPrompt.ts` | NEW — Operations assistant system prompt builder |
| `src/features/agents/sub_chat/libs/chatOpsDispatch.ts` | NEW — Parse operation JSON from assistant output, dispatch to backend |
| `src-tauri/src/engine/prompt.rs` | Add `assemble_ops_prompt()` for operations assistant context |
| `src-tauri/src/commands/execution/executions.rs` | Add `execute_chat_ops` command that routes ops to appropriate handlers |

### 1.5 Chat Session Migration

- Existing chat sessions remain as "Agent Conversations" (legacy mode)
- New sessions default to "Operations" mode
- Mode toggle: Operations | Agent Chat (keep both available)
- Session type stored in `chat_sessions.session_type` column

---

## Phase 2: Sidebar Panel Integration

### 2.1 Sidebar Layout

The chat gets a collapsible left sidebar with 4 panels:

```typescript
type SidebarPanel = 'run' | 'lab' | 'health' | 'assertions';

interface PanelConfig {
  id: SidebarPanel;
  icon: LucideIcon;
  label: string;
  component: React.ComponentType;
  badge?: number; // e.g., failing assertion count
}
```

### 2.2 Panel Content (compact versions of existing tabs)

| Panel | Content | Source Component |
|-------|---------|-----------------|
| **Run** | Execute button + last 3 execution summaries + stream output | Extracted from current execution UI |
| **Lab** | Mode selector + active/recent run status + score summary | Compact version of LabTab |
| **Health** | Score ring + issue list with fix buttons | Compact version of HealthCheckPanel |
| **Assertions** | Active rules list + pass rates + quick add | Compact version of AssertionPanel |

### 2.3 Chat <-> Panel References

The assistant can reference panels:
- "I've started an arena test — check the Lab panel for progress"
- "The health check found 2 issues — see the Health panel for details"
- Clickable links in chat messages open the corresponding panel

---

## Phase 3: Assertions -> Lab Integration

### 3.1 Auto-run Assertions on Lab Results

After each lab scenario execution completes:
1. Extract the execution output text
2. Run all active assertions against it
3. Store results in `assertion_results` linked to the lab result ID
4. Display pass/fail badges inline in arena/matrix result views

### 3.2 Implementation

| File | Change |
|------|--------|
| `src-tauri/src/engine/test_runner.rs` | After `score_result()`, run assertions against output |
| `src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx` | Add assertion badge column |
| `src/features/agents/sub_lab/components/matrix/MatrixResultsView.tsx` | Add assertion badge |

---

## Module Status After Consolidation

| Tab | Status | Access |
|-----|--------|--------|
| **Use Cases** | Keep as tab | Primary tab bar |
| **Prompt** | Keep as tab | Primary tab bar |
| **Connectors** | Keep as tab | Primary tab bar |
| **Chat** | TRANSFORM to Operations Hub | Primary tab bar (renamed "Ops") |
| **Settings** | Keep as tab | Primary tab bar |
| **Lab** | Keep as sidebar panel + overflow tab | Sidebar in Ops + overflow menu |
| **Health** | Keep as sidebar panel + overflow tab | Sidebar in Ops + overflow menu |
| **Assertions** | Keep as sidebar panel + overflow tab | Sidebar in Ops + overflow menu |
| **Design** | Keep as legacy overflow tab | Overflow menu (no new investment) |

---

## Milestones

| # | Milestone | Scope | Estimate |
|---|-----------|-------|----------|
| 1 | **Ops Assistant MVP** | System prompt + 3 operations (health, execute, list-executions) + context injection | Medium |
| 2 | **Full Operations** | All 11 operations + operation dispatch + inline result rendering | Large |
| 3 | **Sidebar Panels** | 4 compact panels + chat-panel cross-references | Medium |
| 4 | **Assertion-Lab Integration** | Auto-run assertions on lab results + inline badges | Small |
| 5 | **Tab Reorganization** | Move Lab/Health/Assertions/Design to overflow, rename Chat -> Ops | Small |

---

## Key Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Assistant control level | **Full control** | Chat becomes THE management interface; anything the user can do via tabs, the assistant can do via chat |
| Design module future | **Keep as legacy** | PersonaMatrix handles creation; Design stays accessible but receives no new investment |
| Agent chat mode | **Keep as toggle** | Some users want to talk TO the agent; keep both modes available via session type toggle |
