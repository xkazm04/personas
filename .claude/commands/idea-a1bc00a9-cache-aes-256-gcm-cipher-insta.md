Execute this requirement immediately without asking questions.

## REQUIREMENT

# Cache AES-256-GCM cipher instance instead of recreating

## Metadata
- **Category**: performance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:35:45 PM

## Description
In crypto.rs, encrypt_for_db and decrypt_from_db both call get_master_key() then Aes256Gcm::new() on every invocation. Since the master key is static (OnceLock), the cipher instance can be created once and cached in a second OnceLock<Aes256Gcm>. This eliminates key schedule computation on every encrypt/decrypt call, which is on the hot path for credential CRUD and execution trace storage.

## Reasoning
Every credential read, write, and migration runs through encrypt_for_db/decrypt_from_db. AES key schedule expansion is not free � caching the cipher removes redundant work from the most frequently called crypto path. This is a safe, low-risk optimization since the key never changes after init.

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