Execute this requirement immediately without asking questions.

## REQUIREMENT

# Execution cancelled graceful feedback with resume

## Metadata
- **Category**: user_benefit
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: user_empathy_champion
- **Generated**: 2/21/2026, 11:44:05 PM

## Description
When users click Stop Execution, the terminal just appends === Execution cancelled === and the UI transitions to idle state. This gives no indication of partial work done or cost incurred. Add a cancellation summary card (similar to the existing execution summary) showing: time elapsed, tokens used so far, estimated cost incurred, and the last tool call that was running. Include a Resume from here button that re-runs the persona with the same input data plus a context hint about where it stopped, so users do not feel like they lost everything by cancelling.

## Reasoning
Cancelling an execution feels like a loss � users spent money and time but got nothing. The abrupt transition from animated running state to a flat cancelled message creates emotional whiplash. A graceful cancellation summary acknowledges the work done and the cost paid, while the resume option transforms cancellation from a destructive action into a pause. This is especially important for long-running executions where users may have cancelled due to a temporary concern rather than wanting to fully abandon the run.

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