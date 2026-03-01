Execute this requirement immediately without asking questions.

## REQUIREMENT

# cancel_pipeline panics on poisoned mutex

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:18:02 AM

## Description
cancel_pipeline (teams.rs:527) uses .unwrap() on active_pipeline_cancelled.lock(), which will panic and crash the application if the mutex is poisoned. A mutex becomes poisoned when a thread panics while holding the lock. Since the spawned pipeline task (line 291) also acquires this mutex (line 281 and 513), any panic inside the pipeline execution path poisons the mutex and makes all subsequent cancel_pipeline calls crash the app. Replace .unwrap() with .lock().unwrap_or_else(|e| e.into_inner()) or use a try-lock pattern that returns an error instead of panicking.

## Reasoning
Mutex poisoning is a cascading failure: one panic during pipeline execution permanently breaks the cancel functionality for all future pipelines in the session. The user clicks Cancel and the entire Tauri command handler panics, which may surface as a cryptic IPC error. The fix is a one-line change from .unwrap() to a poison-tolerant lock acquisition.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Team Pipeline Builder

**Description**: Visually design multi-agent pipelines on a React Flow canvas. Drag persona nodes, connect them with edges, configure team topology, and use the AI optimizer to improve pipeline efficiency. Manage team configurations and orchestrate agent collaboration.
**Related Files**:
- `src/features/pipeline/components/TeamCanvas.tsx`
- `src/features/pipeline/components/TeamConfigPanel.tsx`
- `src/features/pipeline/components/TeamList.tsx`
- `src/features/pipeline/sub_canvas/PersonaNode.tsx`
- `src/features/pipeline/sub_canvas/ConnectionEdge.tsx`
- `src/features/pipeline/sub_canvas/GhostEdge.tsx`
- `src/features/pipeline/sub_canvas/NodeContextMenu.tsx`
- `src/features/pipeline/sub_canvas/EdgeDeleteTooltip.tsx`
- `src/features/pipeline/sub_canvas/CanvasAssistant.tsx`
- `src/features/pipeline/sub_canvas/OptimizerPanel.tsx`
- `src/features/pipeline/sub_canvas/PipelineControls.tsx`
- `src/features/pipeline/sub_canvas/TeamToolbar.tsx`
- `src/features/pipeline/sub_canvas/teamConstants.tsx`
- `src/api/teams.ts`
- `src/stores/slices/teamSlice.ts`
- `src-tauri/src/commands/teams/teams.rs`
- `src-tauri/src/db/repos/resources/teams.rs`
- `src-tauri/src/db/models/team.rs`
- `src-tauri/src/engine/topology.rs`
- `src-tauri/src/engine/optimizer.rs`

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