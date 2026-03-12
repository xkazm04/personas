Execute this requirement immediately without asking questions.

## REQUIREMENT

# CREDENTIAL_REFRESH_LOCKS HashMap grows unboundedly

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/12/2026, 3:33:46 PM

## Description
In runner.rs, the static CREDENTIAL_REFRESH_LOCKS is a HashMap<String, Arc<Mutex<()>>> that adds an entry for every credential ID that triggers an OAuth refresh, but never removes entries. Over the app lifetime with credential rotation, this grows without bound. Add periodic cleanup: when acquiring a lock, prune entries whose Arc strong_count is 1 (no other holder), or use a bounded LRU cache.

## Reasoning
This is a slow memory leak that manifests over weeks/months of continuous operation. Each entry is small (String key + Arc overhead) but in a desktop app that runs persistently, hundreds of rotated credential IDs accumulate. More critically, if credentials are recreated frequently (e.g., re-linking OAuth), the leak accelerates. The fix is trivial and prevents a class of long-running-app degradation.

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