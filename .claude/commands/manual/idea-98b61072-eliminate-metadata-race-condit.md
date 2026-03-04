Execute this requirement immediately without asking questions.

## REQUIREMENT

# Eliminate Metadata Race Conditions in Healthcheck

## Metadata
- **Category**: code_quality
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: zen_architect
- **Generated**: 3/3/2026, 9:24:18 PM

## Description
In useCredentialHealth.ts, checkStored reads metadata, merges health status, and calls updateCredential. If a user or background process edits the credential simultaneously, data is overwritten. Implement an atomic patchCredentialMetadata endpoint.

## Reasoning
Read-modify-write cycles on the client side for JSON blobs are a textbook race condition. An atomic backend patch prevents silent data loss of rotation schedules or user configurations during background healthchecks.

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