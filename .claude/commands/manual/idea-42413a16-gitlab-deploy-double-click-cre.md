Execute this requirement immediately without asking questions.

## REQUIREMENT

# GitLab deploy double-click creates duplicate agents

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/3/2026, 1:33:40 AM

## Description
GitLabDeployModal.handleDeploy (line 32) guards with setIsDeploying(true) React state, but setState is async � a fast double-click fires two onDeploy calls before the first render disables the button. Each call creates an agent definition in the GitLab project and potentially provisions CI/CD variables. This produces duplicate agents and can overwrite credential variables mid-provisioning. Add a synchronous ref guard (e.g. deployingRef.current) checked before the async call, or use a proper mutex pattern to prevent concurrent deploys.

## Reasoning
Deployment is the highest-stakes operation in this context � it writes agent definitions and secrets to a live GitLab project. Duplicate agents cause CI confusion and potentially conflicting pipelines. Credential double-provisioning could create race conditions where one deploy overwrites the other halfway through writing variables.

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

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

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