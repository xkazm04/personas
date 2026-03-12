Execute this requirement immediately without asking questions.

## REQUIREMENT

# Fix unsafe type casts in ReviewDetailPanel

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 3:49:27 PM

## Description
ReviewDetailPanel.tsx uses double-casts (as unknown as { suggested_actions?: string }) to access suggested_actions and context_data fields that exist on the backend PersonaManualReview model but are missing from the frontend ManualReviewItem type. Fix the frontend type definition to include these fields properly, eliminating the TypeScript bypass and preventing silent breakage if the backend schema changes.

## Reasoning
Double-casts hide type mismatches that TypeScript is designed to catch. If the backend renames or removes these fields, the frontend will silently read undefined with no compile-time error. This is a small fix with outsized safety benefit � it makes the type system trustworthy again for this component.

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