Execute this requirement immediately without asking questions.

## REQUIREMENT

# BYOM compliance vs allowed_providers precedence undefined

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 3:28:14 PM

## Description
ByomPolicy::evaluate() applies allowed_providers first (blocking everything not listed), then compliance rules further restrict. But what if a compliance rule allows_providers includes a provider not in the top-level allowed_providers? The current code silently ignores it � the top-level block wins. This interaction is undocumented and surprising. Add an explicit validation step when saving a policy that warns when compliance rules reference providers not in the allowed set, and add a doc comment clarifying the precedence: top-level allowed is the ceiling, compliance rules can only narrow within it.

## Reasoning
Policy conflicts between allowed_providers and compliance_rules will silently produce unexpected blocking with no user-facing explanation. An admin configuring HIPAA compliance to allow Gemini while the org blocks Gemini gets no warning � Gemini just never works. Validation at save-time prevents this confusion.

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