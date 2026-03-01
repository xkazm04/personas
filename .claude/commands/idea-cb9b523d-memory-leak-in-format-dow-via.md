Execute this requirement immediately without asking questions.

## REQUIREMENT

# Memory leak in format_dow via Box::leak on every call

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:19:50 AM

## Description
In triggers.rs commands (line 458), format_dow uses Box::leak(s.into_boxed_str()) to convert a String to a &str for day-of-week range formatting. This permanently leaks memory on every call. The previewCronSchedule command is called on every keystroke in TriggerAddForm as the user types a cron expression. A user editing a cron expression with a day range like 1-5 will leak a String allocation per keystroke. Fix by collecting into Vec<String> instead of Vec<&str>, or use Cow<str>.

## Reasoning
Box::leak is one of the most dangerous patterns in Rust because it intentionally bypasses the borrow checker by leaking heap memory. In a desktop app that runs continuously, this accumulates over time. The cron preview is called interactively during form editing, making the leak rate proportional to typing speed. Over a day of trigger configuration, this could leak megabytes.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Triggers & Event Routing

**Description**: Define event triggers that automatically activate agents. Configure trigger conditions, build event flows with visual diagrams, manage event subscriptions, and route events between agents in the system.
**Related Files**:
- `src/features/triggers/components/EventsPage.tsx`
- `src/features/triggers/components/TriggerList.tsx`
- `src/features/triggers/components/TriggerListItem.tsx`
- `src/features/triggers/components/TriggerAddForm.tsx`
- `src/features/triggers/components/TriggerConfig.tsx`
- `src/features/triggers/components/TriggerFlowBuilder.tsx`
- `src/features/triggers/components/EventSubscriptionsPanel.tsx`
- `src/features/triggers/components/ActivityDiagramModal.tsx`
- `src/api/triggers.ts`
- `src/api/events.ts`
- `src/stores/slices/triggerSlice.ts`
- `src/stores/slices/eventSlice.ts`
- `src/lib/utils/triggerConstants.ts`
- `src-tauri/src/commands/tools/triggers.rs`
- `src-tauri/src/commands/communication/events.rs`
- `src-tauri/src/db/repos/resources/triggers.rs`
- `src-tauri/src/db/repos/communication/events.rs`
- `src-tauri/src/db/models/trigger.rs`
- `src-tauri/src/db/models/event.rs`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

## Notes

This requirement was generated from an AI-evaluated project idea. No specific goal is associated with this idea.

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