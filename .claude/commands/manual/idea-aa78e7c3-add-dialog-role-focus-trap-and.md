Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add dialog role, focus trap, and Escape to delete confirm

## Metadata
- **Category**: ui
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 2:17:46 AM

## Description
CredentialDeleteDialog.tsx renders a modal overlay with a confirmation prompt but has no role="dialog", no aria-modal="true", no aria-labelledby, no focus trap, and no Escape key handler. ConnectorCredentialModal correctly implements all five of these � the delete dialog should match. Add role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" to the motion.div container. Add id="delete-dialog-title" to the h3 warning title. Implement a Tab/Shift-Tab focus trap by querying focusable elements within the dialog (matching ConnectorCredentialModal pattern). Add a useEffect with a keydown listener for Escape that calls onCancelDelete. Move initial focus to the Cancel button (not Delete) on open via autoFocus or a ref.focus() in useEffect, so the safe action is the default keyboard target.

## Reasoning
The delete dialog is the single most destructive action in the vault � credentials control access to production services. Making the delete confirmation inaccessible to keyboard and screen reader users is a safety gap, not just an accessibility gap. Focusing the Cancel button by default (rather than Delete) follows the principle of error prevention: the destructive action requires deliberate navigation. ConnectorCredentialModal already demonstrates the correct implementation pattern in the same codebase, so the fix is a proven copy-adapt rather than new engineering.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Credential Management

**Description**: Store, edit, and organize API credentials and secrets. Browse credentials in a list or picker, view card details with health checks, manage rotation policies, and connect credentials to specific connector types with schema-driven forms.
**Related Files**:
- `src/features/vault/sub_manager/CredentialManager.tsx`
- `src/features/vault/sub_list/CredentialList.tsx`
- `src/features/vault/sub_list/CredentialPicker.tsx`
- `src/features/vault/sub_card/CredentialCard.tsx`
- `src/features/vault/sub_card/CredentialCardBody.tsx`
- `src/features/vault/sub_card/CredentialCardDetails.tsx`
- `src/features/vault/sub_card/CredentialCardHeader.tsx`
- `src/features/vault/sub_card/CredentialDeleteDialog.tsx`
- `src/features/vault/sub_card/RotationInsightBadge.tsx`
- `src/features/vault/sub_card/VaultStatusBadge.tsx`
- `src/features/vault/sub_forms/ConnectorCredentialModal.tsx`
- `src/features/vault/sub_forms/CredentialEditForm.tsx`
- `src/features/vault/sub_forms/CredentialTemplateForm.tsx`
- `src/features/vault/sub_forms/CredentialTypePicker.tsx`
- `src/features/vault/sub_forms/HealthcheckResultDisplay.tsx`
- `src/features/vault/sub_schemas/CredentialSchemaForm.tsx`
- `src/features/vault/sub_schemas/ExtraFieldRenderers.tsx`
- `src/features/vault/sub_schemas/McpPrefilledForm.tsx`
- `src/features/vault/sub_schemas/schemaConfigs.tsx`
- `src/features/vault/sub_schemas/schemaFormTypes.ts`
- `src/features/vault/utils/authMethodStyles.ts`
- `src/features/vault/hooks/useCredentialViewFSM.ts`
- `src/features/vault/hooks/useCredentialHealth.ts`
- `src/features/vault/hooks/useUndoDelete.ts`
- `src/features/vault/hooks/useRotationTicker.ts`
- `src/api/credentials.ts`
- `src/api/rotation.ts`
- `src/stores/slices/credentialSlice.ts`
- `src/lib/credentials/builtinConnectors.ts`

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