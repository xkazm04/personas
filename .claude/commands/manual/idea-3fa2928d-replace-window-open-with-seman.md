Execute this requirement immediately without asking questions.

## REQUIREMENT

# Replace window.open with semantic anchors and add rel

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 8:53:21 AM

## Description
Four places use button onClick with window.open to navigate to external URLs: CloudDeployPanel (line 91), GitLabAgentList (line 81), GitLabConnectionForm (line 59), and GitLabDeployModal (line 147). None include rel=noopener noreferrer, creating a tab-napping vulnerability where the opened page can access window.opener. Replace all with anchor elements using target=_blank and rel=noopener noreferrer, styled as buttons. This restores right-click context menus and middle-click for power users.

## Reasoning
Using window.open without rel=noopener noreferrer is an OWASP-recognized vulnerability. The opened page has access to window.opener, allowing it to redirect the parent tab to a phishing page. In a deployment context where users enter API keys and OAuth tokens, this is a meaningful security concern. Semantic anchors also improve keyboard navigability and restore browser-native link behaviors.

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