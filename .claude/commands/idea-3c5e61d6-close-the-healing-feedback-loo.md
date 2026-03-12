Execute this requirement immediately without asking questions.

## REQUIREMENT

# Close the healing feedback loop with knowledge base

## Metadata
- **Category**: functionality
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: insight_synth
- **Generated**: 3/12/2026, 10:20:40 AM

## Description
The healing knowledge base (healing_knowledge table) tracks fleet-wide failure patterns but the rule-based diagnose() function never consults it. Wire get_recommended_delay() into the diagnosis path so that backoff delays and escalation thresholds adapt based on accumulated fleet experience. When a pattern_key has high occurrence_count, healing should preemptively escalate rather than burning through retries.

## Reasoning
The knowledge base is a learning system disconnected from the decision system. This creates a closed feedback loop: classify � diagnose � act � record � future diagnoses benefit. Currently the system has memory (knowledge base) but no recall (diagnose ignores it). Connecting them transforms healing from static rules into an adaptive immune system.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Healing & Resilience

**Description**: Self-healing engine, AI-assisted healing, auto-rollback, health checks, rate limiting for execution reliability.
**Related Files**:
- `src/api/overview/healing.ts`
- `src/api/overview/healthcheckApi.ts`
- `src/stores/slices/overview/healingSlice.ts`
- `src-tauri/src/commands/execution/healing.rs`
- `src-tauri/src/engine/healing.rs`
- `src-tauri/src/engine/ai_healing.rs`
- `src-tauri/src/engine/auto_rollback.rs`
- `src-tauri/src/engine/healthcheck.rs`
- `src-tauri/src/engine/rate_limiter.rs`
- `src-tauri/src/db/models/healing.rs`
- `src-tauri/src/db/repos/execution/healing.rs`
- `src/features/overview/sub_observability/components/HealingIssuesPanel.tsx`
- `src/features/overview/sub_observability/components/HealingIssueModal.tsx`
- `src/features/overview/sub_observability/components/HealingIssueSummary.tsx`

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