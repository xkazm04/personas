Execute this requirement immediately without asking questions.

## REQUIREMENT

# Unify tag serialization: JSON vs comma-separated

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 3:49:13 PM

## Description
Memory tags are stored as JSON arrays via createMemory (memorySlice.ts JSON.stringify) but as comma-separated strings in seed_mock_memory (memories.rs command). MemoryCard.tsx parseJsonOrDefault silently returns [] for comma-separated tags, hiding seeded data. Define a single canonical format (JSON array), add a migration or normalization step for legacy data, and validate on write in the backend.

## Reasoning
Two serialization formats for the same field is a classic ambiguity that causes silent data loss. Tags appear empty for mock/seeded memories, misleading developers during testing. Fixing this now prevents the inconsistency from spreading as more code writes tags.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Messages, Memories & Reviews

**Description**: Message inbox, memory management with conflict resolution, manual review queue with approval workflow, and design review generation.
**Related Files**:
- `src/api/overview/messages.ts`
- `src/api/overview/memories.ts`
- `src/api/overview/reviews.ts`
- `src/stores/slices/overview/messageSlice.ts`
- `src/stores/slices/overview/memorySlice.ts`
- `src/features/overview/sub_messages/components/MessageList.tsx`
- `src/features/overview/sub_memories/components/MemoriesPage.tsx`
- `src/features/overview/sub_memories/components/MemoryCard.tsx`
- `src/features/overview/sub_memories/components/CreateMemoryForm.tsx`
- `src/features/overview/sub_memories/components/ConflictCard.tsx`
- `src/features/overview/sub_memories/components/MemoryFilterBar.tsx`
- `src/features/overview/sub_manual-review/components/ManualReviewList.tsx`
- `src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx`
- `src/features/overview/sub_manual-review/components/ReviewInboxPanel.tsx`
- `src-tauri/src/commands/communication/messages.rs`
- `src-tauri/src/commands/core/memories.rs`
- `src-tauri/src/commands/design/reviews.rs`
- `src-tauri/src/db/models/message.rs`
- `src-tauri/src/db/models/memory.rs`
- `src-tauri/src/db/models/review.rs`
- `src-tauri/src/db/repos/communication/messages.rs`
- `src-tauri/src/db/repos/communication/reviews.rs`
- `src-tauri/src/db/repos/communication/manual_reviews.rs`
- `src-tauri/src/db/repos/core/memories.rs`

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