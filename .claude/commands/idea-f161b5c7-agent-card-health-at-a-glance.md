Execute this requirement immediately without asking questions.

## REQUIREMENT

# Agent card health-at-a-glance with status ring

## Metadata
- **Category**: ui
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: user_empathy_champion
- **Generated**: 2/21/2026, 11:45:37 PM

## Description
PersonaOverviewPage shows agent cards with Active/Inactive badges and trigger counts, but users cannot tell which agents are healthy vs. struggling without clicking into each one. Add a subtle colored ring around each card icon that encodes recent health: solid green ring = all recent executions succeeded, amber ring with gap = some failures, red ring = mostly failing, grey dashed ring = no recent activity. On hover, show a micro-tooltip with last 5 execution results as dots (green/red). This gives users an instant fleet health dashboard without adding visual clutter.

## Reasoning
Users managing 5+ agents feel anxious because they cannot see problems at a glance. The current card shows last-run time but not whether it succeeded. Users have to click into each agent, navigate to execution history, and mentally aggregate results. A health ring provides passive awareness � users glance at the grid and immediately know which agents need attention. This is the difference between managing agents and monitoring agents.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Roster & Onboarding

**Description**: Browse, create, group, and onboard new AI personas. Includes persona cards grid, group-based sidebar navigation, creation modal, and step-by-step onboarding wizard with health checks and template selection.
**Related Files**:
- `src/features/agents/components/PersonaOverviewPage.tsx`
- `src/features/agents/components/PersonaCard.tsx`
- `src/features/agents/components/CreatePersonaModal.tsx`
- `src/features/agents/components/GroupedAgentSidebar.tsx`
- `src/features/agents/components/OnboardingWizard.tsx`
- `src/features/agents/components/onboarding/OnboardingHealthCheck.tsx`
- `src/features/agents/components/onboarding/OnboardingTemplateStep.tsx`
- `src/api/groups.ts`
- `src/stores/slices/groupSlice.ts`
- `src/stores/slices/toolSlice.ts`
- `src-tauri/src/commands/core/groups.rs`
- `src-tauri/src/commands/tools/tools.rs`
- `src-tauri/src/db/repos/core/groups.rs`
- `src-tauri/src/db/repos/resources/tools.rs`
- `src-tauri/src/db/models/group.rs`
- `src-tauri/src/db/models/tool.rs`

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