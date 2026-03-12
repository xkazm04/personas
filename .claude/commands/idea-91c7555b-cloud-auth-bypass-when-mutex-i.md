Execute this requirement immediately without asking questions.

## REQUIREMENT

# Cloud auth bypass when mutex is contended

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (9/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/12/2026, 3:37:54 PM

## Description
In ipc_auth.rs:78, require_cloud_auth_sync returns Ok(()) when the auth mutex lock fails (Err(_) => Ok(())). If the mutex is poisoned or contended, unauthenticated users silently pass the cloud auth gate. Replace the Err fallback with Err(AppError::Auth("Auth state unavailable")) to fail-closed instead of fail-open.

## Reasoning
This is a security bypass: any cloud command (deploy, execute, manage remote agents) can be called without authentication if the mutex is poisoned by a prior panic. Fail-open auth checks are a critical vulnerability class. The fix is a one-line change.

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