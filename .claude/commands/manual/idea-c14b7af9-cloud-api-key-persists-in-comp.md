Execute this requirement immediately without asking questions.

## REQUIREMENT

# Cloud API key persists in component state after disconnect

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/3/2026, 1:33:34 AM

## Description
CloudDeployPanel.handleDisconnect (line 83) calls cloudDisconnectAction which clears Zustand store state, but never calls setApiKey("") or setUrl(""). The API key remains in React useState and pre-fills the password input when the user returns to the connection tab. Compare with GitLabPanel.handleDisconnect (line 68) which correctly calls setToken(""). Add setApiKey("") and setUrl("") to handleDisconnect to match the GitLab pattern.

## Reasoning
This is a credential hygiene issue. After disconnecting, users reasonably expect their credentials are gone. Instead, the API key persists in the DOM (discoverable via React DevTools or inspector), and a shared-computer scenario could expose it to the next user. The GitLab side already handles this correctly, so this is clearly an oversight.

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