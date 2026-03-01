Execute this requirement immediately without asking questions.

## REQUIREMENT

# SSRF via validate_trigger polling endpoint check

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:20:06 AM

## Description
validate_trigger (triggers.rs commands:160-176) sends an HTTP HEAD request to whatever URL is configured in a polling triggers endpoint field. There is no validation that the URL points to an external host. A user can set endpoint to http://127.0.0.1:9420, http://169.254.169.254/latest/meta-data/ (cloud metadata), or any internal network address. The reqwest client follows redirects by default, amplifying the attack surface. Add an allowlist or denylist for private IP ranges (RFC 1918, link-local, loopback) and disable redirect following for the validation client.

## Reasoning
While this is a desktop app (reducing attack surface vs. a server), it still runs on the users network and can be used to probe internal services that the desktop machine can reach. If the app is ever exposed via remote access or used in a shared environment, this becomes a full SSRF. The fix is straightforward (URL validation) and follows defense-in-depth principles.

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