Execute this requirement immediately without asking questions.

## REQUIREMENT

# Global circuit breaker ignores successes in window

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/12/2026, 3:33:53 PM

## Description
In failover.rs, record_success() resets per-provider state but does NOT clear entries from GlobalState.failure_times. This means a provider can succeed repeatedly while old failure timestamps still count toward the global threshold. Scenario: 8 failures across providers, then 100 successes, then 2 more failures within the window -- the global breaker trips despite the system being healthy. Fix by either clearing failure_times entries for the successful provider or resetting the global counter on success streaks.

## Reasoning
The global circuit breaker is meant to detect cascading failures across all providers. But because successes do not reduce the failure count, transient bursts of errors (e.g., a brief network hiccup) leave a lingering failure count that accumulates toward the threshold even after full recovery. This causes false-positive global pauses that block ALL providers for 60 seconds unnecessarily.

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