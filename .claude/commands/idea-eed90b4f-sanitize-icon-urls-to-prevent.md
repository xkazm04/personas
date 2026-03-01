Execute this requirement immediately without asking questions.

## REQUIREMENT

# Sanitize icon URLs to prevent SSRF via img src rendering

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:29:02 AM

## Description
In PersonaEditor.tsx (line 326), any persona icon value starting with "http" is rendered as <img src={selectedPersona.icon}>. This allows: (a) SSRF against localhost/private-network services when the Tauri app renders the img tag � a GET request fires to the URL on render, (b) IP/timing information leakage to attacker-controlled servers embedded in persona templates or imports, (c) tracking pixels if a persona is shared/imported with a malicious icon URL. The img tag has no referrerPolicy, crossOrigin, or loading attributes. Fix by implementing a URL allowlist (only HTTPS, only public domains), or better yet, proxy icon URLs through a backend fetch-and-cache handler that validates the response is actually an image. At minimum, add referrerPolicy="no-referrer" and block non-HTTPS URLs.

## Reasoning
This is a real security vulnerability in a desktop app that runs with local network access. An attacker who can set a persona icon (via template import, shared config, or design analysis output) can probe the user's local network from within the Tauri webview. The fix ranges from trivial (block non-HTTPS, add referrerPolicy) to thorough (proxy and validate).

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Persona Editor & Configuration

**Description**: Configure and customize AI agents with prompt editing, model selection, connector assignment, tool picking, and notification channel setup. The main workspace for tuning persona behavior.
**Related Files**:
- `src/features/agents/sub_editor/PersonaEditor.tsx`
- `src/features/agents/sub_editor/DesignTab.tsx`
- `src/features/agents/sub_editor/PersonaSettingsTab.tsx`
- `src/features/agents/sub_editor/PersonaConnectorsTab.tsx`
- `src/features/agents/sub_editor/PersonaPromptEditor.tsx`
- `src/features/agents/sub_editor/ToolSelector.tsx`
- `src/features/agents/sub_editor/EditorDocument.tsx`
- `src/features/agents/sub_editor/EventSubscriptionSettings.tsx`
- `src/features/agents/sub_editor/NotificationChannelSettings.tsx`
- `src/features/agents/sub_editor/PersonaDraft.ts`
- `src/features/agents/sub_editor/wizardSteps.ts`
- `src/features/agents/sub_editor/model-config/ModelSelector.tsx`
- `src/features/agents/sub_editor/model-config/LiteLLMConfigField.tsx`
- `src/features/agents/sub_editor/model-config/OllamaApiKeyField.tsx`
- `src/features/agents/sub_editor/model-config/OllamaCloudPresets.ts`
- `src/features/agents/sub_editor/model-config/ProviderCredentialField.tsx`
- `src/features/agents/sub_editor/model-config/SaveConfigButton.tsx`
- `src/features/agents/components/GroupedAgentSidebar.tsx`
- `src/features/agents/components/PersonaHoverPreview.tsx`
- `src/features/agents/components/PersonaOverviewPage.tsx`
- `src/features/agents/components/sub_sidebar/DraggablePersonaCard.tsx`
- `src/features/agents/components/sub_sidebar/DroppableGroup.tsx`
- `src/features/agents/components/sub_sidebar/PersonaContextMenu.tsx`
- `src/api/personas.ts`
- `src/api/groups.ts`
- `src/api/tools.ts`
- `src/stores/slices/personaSlice.ts`
- `src/stores/slices/toolSlice.ts`
- `src/stores/slices/groupSlice.ts`
- `src-tauri/src/commands/core/personas.rs`
- `src-tauri/src/commands/core/groups.rs`
- `src-tauri/src/db/repos/core/personas.rs`
- `src-tauri/src/db/repos/core/groups.rs`
- `src-tauri/src/db/models/persona.rs`
- `src-tauri/src/db/models/group.rs`
- `src-tauri/src/db/models/tool.rs`

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