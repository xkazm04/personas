Execute this requirement immediately without asking questions.

## REQUIREMENT

# Persona card hover preview with live stats

## Metadata
- **Category**: ui
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: delight_designer
- **Generated**: 2/21/2026, 11:35:52 PM

## Description
PersonaOverviewPage cards (PersonaOverviewPage.tsx:46-119) show static info but lack an on-hover preview that surfaces real-time context. Add a hover card (tooltip-style popover) that appears after 300ms showing: last execution status with duration, active trigger summary, total runs today, and a 7-day sparkline of execution frequency. Implement using a portal-based popover positioned relative to the card, with framer-motion fade-in. Data comes from existing personaLastRun, personaTriggerCounts, and a new lightweight listExecutions call cached in the store.

## Reasoning
Currently users must click into each persona to get operational context. With 10+ agents, this creates excessive navigation just to answer the question: is this agent healthy? A hover preview eliminates this round-trip, providing at-a-glance operational awareness without leaving the overview grid. This is the kind of polish that makes dashboards feel alive rather than static.

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