Execute this requirement immediately without asking questions.

## REQUIREMENT

# try_acquire has hidden side-effect: resets circuit state

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 3:28:00 PM

## Description
ProviderCircuitBreaker::try_acquire() is named like a read-check but mutates state: it resets opened_at and consecutive_failures when cooldown expires, and clears global pause state. This means calling try_acquire twice for the same provider has different behavior than calling it once (first call resets, second sees clean state). Document this mutation contract explicitly via rename to try_acquire_and_probe() or split into a pure is_available_no_reset() plus an explicit reset_if_cooled() so callers understand the side-effect boundary.

## Reasoning
A function named try_acquire that silently resets circuit breaker state is a trap for future maintainers. The is_available() wrapper delegates to it, compounding confusion. Making the mutation explicit prevents accidental double-resets and makes the half-open probe semantics discoverable.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Runner & Providers

**Description**: Core execution runtime with multi-provider support (Claude, Codex, Copilot, Gemini), dispatch, failover, queue, and streaming output.
**Related Files**:
- `src-tauri/src/engine/runner.rs`
- `src-tauri/src/engine/dispatch.rs`
- `src-tauri/src/engine/queue.rs`
- `src-tauri/src/engine/failover.rs`
- `src-tauri/src/engine/provider/mod.rs`
- `src-tauri/src/engine/provider/claude.rs`
- `src-tauri/src/engine/provider/codex.rs`
- `src-tauri/src/engine/provider/copilot.rs`
- `src-tauri/src/engine/provider/gemini.rs`
- `src-tauri/src/engine/llm_topology.rs`
- `src-tauri/src/engine/optimizer.rs`
- `src-tauri/src/engine/tier.rs`
- `src-tauri/src/engine/parser.rs`
- `src-tauri/src/engine/types.rs`
- `src-tauri/src/engine/byom.rs`
- `src-tauri/src/engine/background.rs`
- `src-tauri/src/engine/composite.rs`
- `src-tauri/src/engine/pipeline.rs`
- `src-tauri/src/engine/chain.rs`
- `src-tauri/src/db/repos/execution/provider_audit.rs`

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