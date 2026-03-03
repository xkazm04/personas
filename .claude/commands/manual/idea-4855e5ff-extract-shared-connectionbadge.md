Execute this requirement immediately without asking questions.

## REQUIREMENT

# Extract shared ConnectionBadge, PanelTabBar, ErrorBanner

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 8:53:22 AM

## Description
Three UI patterns are byte-for-byte duplicated between CloudDeployPanel and GitLabPanel: the ConnectionStatusBadge (Connected/Disconnected with Wifi/WifiOff icon at lines 103-113 and 76-86), the PanelTabBar (tab button list with active underline at lines 124-145 and 98-119 differing only by accent color), and the ErrorBanner (conditional red border-t div at lines 179-183 and 156-160). Extract into three shared components in src/features/shared/components/.

## Reasoning
These three exact duplications mean every fix must be applied twice and any divergence creates visual inconsistency (already happening with emerald border opacities). Extracting shared components enforces visual parity and halves future maintenance. The PanelTabBar component also becomes the natural place to add the missing ARIA tablist/tab pattern once, benefiting both panels automatically.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Cloud & GitLab Deployment

**Description**: Deploy agents to cloud infrastructure and GitLab CI/CD. Connect to cloud services via OAuth, monitor cloud worker status, configure GitLab connections, and deploy agent definitions as GitLab agents.
**Related Files**:
- `src/features/deployment/components/CloudConnectionForm.tsx`
- `src/features/deployment/components/CloudDeployPanel.tsx`
- `src/features/deployment/components/CloudOAuthPanel.tsx`
- `src/features/deployment/components/CloudStatusPanel.tsx`
- `src/features/gitlab/components/GitLabAgentList.tsx`
- `src/features/gitlab/components/GitLabConnectionForm.tsx`
- `src/features/gitlab/components/GitLabDeployModal.tsx`
- `src/features/gitlab/components/GitLabPanel.tsx`
- `src/api/gitlab.ts`
- `src/api/cloud.ts`
- `src/stores/slices/gitlabSlice.ts`
- `src/stores/slices/cloudSlice.ts`
- `src/lib/bindings/GitLabAgent.ts`
- `src/lib/bindings/GitLabConfig.ts`
- `src/lib/bindings/GitLabDeployResult.ts`
- `src/lib/bindings/GitLabProject.ts`
- `src/lib/bindings/GitLabUser.ts`
- `src/lib/bindings/GitLabAgentDefinition.ts`
- `src/lib/bindings/GitLabAgentTool.ts`
- `src/lib/bindings/CloudConfig.ts`
- `src/lib/bindings/CloudStatusResponse.ts`
- `src/lib/bindings/CloudOAuthAuthorizeResponse.ts`
- `src/lib/bindings/CloudOAuthStatusResponse.ts`
- `src/lib/bindings/CloudWorkerCounts.ts`

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