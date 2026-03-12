Execute this requirement immediately without asking questions.

## REQUIREMENT

# Document desktop connector allowed_paths lifecycle

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 3:33:57 PM

## Description
Desktop connector manifests in desktop_security.rs declare allowed_paths as empty vectors with comments like "populated dynamically from workspace" (line 279) and "populated dynamically" (line 318), but there is no code in this module that performs the population. Add inline documentation specifying which component is responsible for populating allowed_paths, when it happens, and what the security implications are if paths remain empty (currently: all file access denied, which is safe but surprising). Add a debug assertion or tracing::warn when a connector attempts file operations with an empty allowed_paths list.

## Reasoning
A new developer reading desktop_security.rs would see empty allowed_paths, read the comment about dynamic population, and have no way to find where that happens without a codebase-wide search. This is tribal knowledge that should be codified. The current behavior (empty = deny all) is safe but could lead to confusing bug reports where file operations silently fail.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Authentication & Security

**Description**: Authentication flows, IPC auth token validation, AES-256-GCM encryption, OS keyring integration, desktop security, and URL safety.
**Related Files**:
- `src/api/auth/auth.ts`
- `src/api/auth/authDetect.ts`
- `src/stores/authStore.ts`
- `src-tauri/src/commands/infrastructure/auth.rs`
- `src-tauri/src/commands/credentials/auth_detect.rs`
- `src-tauri/src/ipc_auth.rs`
- `src-tauri/src/engine/crypto.rs`
- `src-tauri/src/engine/desktop_security.rs`
- `src-tauri/src/engine/url_safety.rs`
- `src-tauri/src/engine/google_oauth.rs`
- `src-tauri/src/validation.rs`
- `src-tauri/src/error.rs`

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