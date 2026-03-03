Execute this requirement immediately without asking questions.

## REQUIREMENT

# triggerHealing replaces all issues with single-persona subset

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/3/2026, 1:30:40 AM

## Description
healingSlice.triggerHealing (line 40) calls listHealingIssues(personaId) for one persona, then set({ healingIssues: issues }) replaces the entire global array. The ObservabilityDashboard displays all personas issues in a single list. After running analysis for persona A, issues from personas B, C, D vanish from the UI until the next full fetchHealingIssues() call. Fix by calling listHealingIssues() without a personaId filter after triggerHealing completes, or merge the single-persona results into the existing array.

## Reasoning
The ObservabilityDashboard is the primary healing issue triage surface. Silently dropping other personas issues after a single-persona analysis run creates a false sense of health � operators may miss critical open issues from other personas. The fix is a one-line change (remove the personaId filter from the post-trigger fetch).

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Observability & Realtime Events

**Description**: Monitor agent performance through observability dashboards with spend tracking and healing insights. Visualize the event bus in real-time with animated particles and timeline playback. Manage agent memories, knowledge graphs, and message delivery.
**Related Files**:
- `src/features/overview/sub_observability/HealingIssueModal.tsx`
- `src/features/overview/sub_observability/MetricsCharts.tsx`
- `src/features/overview/sub_observability/ObservabilityDashboard.tsx`
- `src/features/overview/sub_observability/SpendOverview.tsx`
- `src/features/overview/sub_realtime/BusLane.tsx`
- `src/features/overview/sub_realtime/EventBusVisualization.tsx`
- `src/features/overview/sub_realtime/EventDetailDrawer.tsx`
- `src/features/overview/sub_realtime/EventParticle.tsx`
- `src/features/overview/sub_realtime/RealtimeStatsBar.tsx`
- `src/features/overview/sub_realtime/RealtimeVisualizerPage.tsx`
- `src/features/overview/sub_realtime/TimelinePlayer.tsx`
- `src/features/overview/sub_realtime/index.ts`
- `src/features/overview/sub_knowledge/KnowledgeGraphDashboard.tsx`
- `src/features/overview/sub_memories/CreateMemoryForm.tsx`
- `src/features/overview/sub_memories/MemoriesPage.tsx`
- `src/features/overview/sub_memories/MemoryCard.tsx`
- `src/features/overview/sub_memories/MemoryFilterBar.tsx`
- `src/features/overview/sub_messages/MessageList.tsx`
- `src/api/observability.ts`
- `src/api/healing.ts`
- `src/api/memories.ts`
- `src/api/messages.ts`
- `src/api/knowledge.ts`
- `src/hooks/realtime/useEventBusListener.ts`
- `src/hooks/realtime/useRealtimeEvents.ts`
- `src/hooks/realtime/useTimelineReplay.ts`
- `src/stores/slices/memorySlice.ts`
- `src/stores/slices/messageSlice.ts`
- `src/stores/slices/healingSlice.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

## Notes

This requirement was generated from an AI-evaluated project idea. No specific goal is associated with this idea.

## DURING IMPLEMENTATION

- Use `get_memory` MCP tool when you encounter unfamiliar code or need context about patterns/files
- Use `report_progress` MCP tool at each major phase (analyzing, planning, implementing, testing, validating)
- Use `get_related_tasks` MCP tool before modifying shared files to check for parallel task conflicts

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