Execute this requirement immediately without asking questions.

## REQUIREMENT

# Avoid double JSON parse in stream line processing

## Metadata
- **Category**: performance
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:31:42 PM

## Description
In runner.rs, each stdout line is first checked by extract_protocol_message() (parser.rs:325) which does a prefix check then serde_json::from_str, and then separately parsed by parse_stream_line() which also does serde_json::from_str on the same line. This means every JSON line from the CLI is deserialized twice. Refactor to parse once into serde_json::Value, then branch on whether it is a protocol message or a stream event. This halves the JSON parsing cost on every line of every execution.

## Reasoning
JSON parsing is the single most CPU-intensive operation per stream line, and it happens on the hottest loop in the system (reading CLI stdout). Every line goes through two full serde_json::from_str calls. For a typical execution emitting 50-200 JSON lines, this is 50-200 redundant deserializations. Eliminating the double parse will noticeably reduce CPU usage during concurrent multi-persona executions.

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