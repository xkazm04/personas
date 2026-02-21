Execute this requirement immediately without asking questions.

## REQUIREMENT

# Execution history empty state with guided first run

## Metadata
- **Category**: ui
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: user_empathy_champion
- **Generated**: 2/21/2026, 11:43:56 PM

## Description
When a user first opens a persona, the execution list shows a bare No execution history yet message. Replace this with a warm, guided empty state: a brief illustration or icon, a message like Your agent is ready to go � run it to see results here, and a prominent Try it now button that scrolls up to the runner and auto-opens the input editor with a helpful example JSON payload pre-filled from the persona template. For personas created from templates, pre-populate the example with relevant sample data.

## Reasoning
The first-run moment is the most emotionally charged: users are excited but unsure. A cold No execution history yet text feels like a dead end and provides zero guidance on what to do next. A guided empty state with a one-click Try it now action bridges the gap between I created a persona and I understand what it does by making the first execution effortless. This is especially important for users who created personas from templates and may not know what input data to provide.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Execution & Monitoring

**Description**: Run AI personas, monitor real-time CLI output, inspect execution details, and track execution history. Includes the runner interface, execution terminal, detail inspector, and global execution list with scheduling and queue management.
**Related Files**:
- `src/features/agents/sub_executions/ExecutionDetail.tsx`
- `src/features/agents/sub_executions/ExecutionInspector.tsx`
- `src/features/agents/sub_executions/ExecutionList.tsx`
- `src/features/agents/sub_executions/ExecutionTerminal.tsx`
- `src/features/agents/sub_executions/PersonaRunner.tsx`
- `src/features/overview/sub_executions/GlobalExecutionList.tsx`
- `src/api/executions.ts`
- `src/api/scheduler.ts`
- `src/hooks/execution/usePersonaExecution.ts`
- `src/hooks/execution/useCorrelatedCliStream.ts`
- `src/stores/slices/executionSlice.ts`
- `src-tauri/src/commands/execution/executions.rs`
- `src-tauri/src/commands/execution/scheduler.rs`
- `src-tauri/src/engine/runner.rs`
- `src-tauri/src/engine/queue.rs`
- `src-tauri/src/engine/background.rs`
- `src-tauri/src/engine/scheduler.rs`
- `src-tauri/src/engine/cron.rs`
- `src-tauri/src/db/repos/execution/executions.rs`
- `src-tauri/src/db/models/execution.rs`
- `src/lib/bindings/PersonaExecution.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

## Notes

This requirement was generated from an AI-evaluated project idea. No specific goal is associated with this idea.

## AFTER IMPLEMENTATION

1. Log your implementation using the `log_implementation` MCP tool with:
   - requirementName: the requirement filename (without .md)
   - title: 2-6 word summary
   - overview: 1-2 paragraphs describing what was done

2. Check for test scenario using `check_test_scenario` MCP tool
   - If hasScenario is true, call `capture_screenshot` tool
   - If hasScenario is false, skip screenshot

3. Verify: `npx tsc --noEmit` (fix any type errors)

Begin implementation now.