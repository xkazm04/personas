Execute this requirement immediately without asking questions.

## REQUIREMENT

# Index review bulk action lookups with a Map

## Metadata
- **Category**: performance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:47:14 PM

## Description
ManualReviewList handleBulkAction iterates selectedIds and calls allReviews.find() for each one � O(n*m) where n is selected count and m is total reviews. Build a Map<id, review> from allReviews once (in useMemo), then use O(1) lookups in both handleBulkAction and activeReview derivation. The same pattern applies to selectablePendingIds which filters the full list on every render.

## Reasoning
Bulk approve/reject is a user-facing action where responsiveness matters. With a growing review queue (dozens to hundreds of items), the repeated linear scans compound. A Map eliminates the O(n*m) lookups and also simplifies the activeReview useMemo from a find() to a get().

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