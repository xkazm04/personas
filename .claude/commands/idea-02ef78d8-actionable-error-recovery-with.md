Execute this requirement immediately without asking questions.

## REQUIREMENT

# Actionable error recovery with one-click fixes

## Metadata
- **Category**: functionality
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: user_empathy_champion
- **Generated**: 2/21/2026, 11:43:48 PM

## Description
ExecutionDetail already has ERROR_PATTERNS that match common failures with guidance text, but the guidance is passive (e.g., Check that your API key is valid). Upgrade each pattern to include an optional action button that navigates directly to the fix. For API key issues, add a Go to Vault button that opens the credential manager. For rate limits, add a Reduce frequency button that opens the trigger config. For timeouts, add an Increase timeout linking to persona settings. The guidance text becomes a recovery workflow rather than a reading exercise.

## Reasoning
When an execution fails, users are already frustrated. Reading guidance like check your API key and having to manually navigate through multiple screens to find the right setting compounds the frustration. One-click navigation to the exact fix location transforms the error experience from I have to figure this out to the app is helping me fix this. The ERROR_PATTERNS infrastructure already exists, making this a high-leverage enhancement.

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