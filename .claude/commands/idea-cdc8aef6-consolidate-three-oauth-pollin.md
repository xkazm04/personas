You are an expert software engineer. Execute the following requirement immediately. Do not ask questions, do not wait for confirmation. Read the requirement carefully and implement all changes to the codebase as specified.

REQUIREMENT TO EXECUTE NOW:

# Consolidate three OAuth polling hooks into one

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: High (3/3)
- **Scan Type**: code_refactor
- **Generated**: 2/23/2026, 9:40:33 PM

## Description
useGoogleOAuth.ts (131 lines), useOAuthConsent.ts (173 lines), and useUniversalOAuth.ts (180 lines) all implement the same pattern: poll session status every 1500ms, handle pending/success/error, open URL via openExternalUrl with window.open fallback, manage isAuthorizing/completedAt/message state. Extract a generic useOAuthPolling hook parameterized by start and poll API functions, reducing ~484 lines to ~150 + 3 thin wrappers.

## Reasoning
Three near-identical copies of the same polling+state+cleanup pattern create maintenance risk � a bug fix in one must be manually applied to all three. Consolidation eliminates ~330 lines of duplicate code and ensures consistent behavior across Google, Universal, and Design OAuth flows.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Credential Management & OAuth

**Description**: Store and manage encrypted API credentials with AES-256-GCM encryption, configure OAuth flows for Google and custom providers, track credential usage and health, manage credential rotation, and browse audit history.
**Related Files**:
- `src/features/vault/components/CredentialManager.tsx`
- `src/features/vault/components/CredentialList.tsx`
- `src/features/vault/components/CredentialCard.tsx`
- `src/features/vault/components/CredentialEditForm.tsx`
- `src/features/vault/components/CredentialDeleteDialog.tsx`
- `src/features/vault/components/CredentialPicker.tsx`
- `src/features/vault/components/CredentialEventConfig.tsx`
- `src/features/vault/components/CredentialIntelligence.tsx`
- `src/features/vault/components/CredentialTemplateForm.tsx`
- `src/features/vault/components/VaultStatusBadge.tsx`
- `src/features/vault/components/ConnectorCredentialModal.tsx`
- `src/features/vault/hooks/useCredentialOAuth.ts`
- `src/features/vault/hooks/useGoogleOAuth.ts`
- `src/features/vault/hooks/useHealthcheckState.ts`
- `src/features/vault/hooks/useTemplateSelection.ts`
- `src/features/vault/hooks/useUndoDelete.ts`
- `src/api/credentials.ts`
- `src/api/connectors.ts`
- `src/api/rotation.ts`
- `src/stores/slices/credentialSlice.ts`
- `src/hooks/design/useOAuthConsent.ts`
- `src/hooks/design/useUniversalOAuth.ts`
- `src-tauri/src/commands/credentials/crud.rs`
- `src-tauri/src/commands/credentials/connectors.rs`
- `src-tauri/src/commands/credentials/oauth.rs`
- `src-tauri/src/commands/credentials/rotation.rs`
- `src-tauri/src/commands/credentials/intelligence.rs`
- `src-tauri/src/engine/crypto.rs`
- `src-tauri/src/engine/healthcheck.rs`
- `src-tauri/src/engine/rotation.rs`
- `src-tauri/src/db/repos/resources/credentials.rs`
- `src-tauri/src/db/repos/resources/connectors.rs`
- `src-tauri/src/db/repos/resources/rotation.rs`
- `src-tauri/src/db/repos/resources/audit_log.rs`
- `src-tauri/src/db/models/credential.rs`
- `src-tauri/src/db/models/connector.rs`
- `src-tauri/src/db/models/rotation.rs`
- `src-tauri/src/db/models/audit_log.rs`
- `src/lib/bindings/PersonaCredential.ts`
- `src/lib/bindings/CreateCredentialInput.ts`
- `src/lib/bindings/UpdateCredentialInput.ts`
- `src/lib/bindings/ConnectorDefinition.ts`
- `src/lib/bindings/CreateConnectorDefinitionInput.ts`
- `src/lib/bindings/CredentialAuditEntry.ts`
- `src/lib/bindings/CredentialDependent.ts`
- `src/lib/bindings/CredentialUsageStats.ts`
- `src/lib/bindings/CredentialProvisionEntry.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

## Notes

This requirement was generated from an AI-evaluated project idea. No specific goal is associated with this idea.

## Implementation Guidelines

**Steps**:
1. Analyze the requirement thoroughly
2. Identify all files that need to be modified or created
3. Implement all changes specified in the requirement
4. Follow implementation steps precisely
5. Run any tests if specified
6. Ensure all changes are complete before finishing

## File Structure (Next.js/React Projects)

**Feature-Specific Files** (use `app/features/<feature>` structure):
- `app/features/<feature>/components/` - Feature-specific components and UI
- `app/features/<feature>/lib/` - Feature-specific functions, utilities, helpers
- `app/features/<feature>/` - Main wrapper, index, or page file

**Reusable UI Components** (use `app/components/ui` structure):
- `app/components/ui/` - Shared, reusable UI elements across multiple features

## Test Selectors

**CRITICAL**: Add `data-testid` attributes to ALL interactive UI components for automated testing.

**Guidelines**:
- Add to all clickable elements (buttons, links, icons)
- Use descriptive kebab-case: `data-testid="submit-form-btn"`
- Include component context: `data-testid="goal-delete-btn"`, `data-testid="project-settings-modal"`
- Add to form inputs: `data-testid="email-input"`
- Add to list items: `data-testid="task-item-123"`

**Example**:
```tsx
<button onClick={handleSubmit} data-testid="create-goal-btn">
  Create Goal
</button>

<input
  type="text"
  value={title}
  onChange={handleChange}
  data-testid="goal-title-input"
/>
```

## Theming and Styling

**Before creating new UI components**:
1. Examine existing components in the project
2. Match the color scheme, spacing, and visual patterns
3. Use consistent className patterns (Tailwind CSS)
4. Follow the app's design language (glassmorphism, gradients, shadows, etc.)
5. Support dark mode if the app uses it

## Documentation Policy

**CRITICAL RULE**: Do NOT create separate documentation files (.md, README.md, docs/) for routine implementations.

**Only create documentation when**:
- Implementing a NEW major feature or module (not refactorings)
- Adding a NEW API or public interface
- Creating NEW architectural patterns
- The requirement explicitly asks for documentation

**Do NOT create documentation for**:
- Bug fixes
- Refactorings
- Small adjustments
- UI changes
- Database schema changes
- Performance improvements
- Code quality improvements

**For all implementations**: Create an implementation log entry (see next section) - this is your primary documentation.

## Implementation Logging

After completing the implementation, log your work via a simple API call.

**DO NOT**:
- ❌ Create separate script files for logging
- ❌ Create SQL scripts or use sqlite3
- ❌ Create documentation files (.md, README.md)

**DO**: Make ONE API call to log your implementation:

```bash
curl -X POST "http://localhost:3000/api/implementation-log" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "0410aba5-7d5b-43a5-98b3-bc0508ba6803",
    "contextId": "ctx_1771875422898_zecaf5p",
    "requirementName": "<requirement-filename-without-.md>",
    "title": "<2-6 word summary>",
    "overview": "<1-2 paragraphs describing implementation>",
    "overviewBullets": "<bullet1>\n<bullet2>\n<bullet3>"
  }'
```

**Field Guidelines**:
- `requirementName`: Requirement filename WITHOUT .md extension
- `title`: 2-6 words (e.g., "User Authentication System")
- `overview`: 1-2 paragraphs describing what was done
- `overviewBullets`: 3-5 key points separated by \n

**Example**:
```bash
curl -X POST "http://localhost:3000/api/implementation-log" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj-123",
    "requirementName": "implement-dark-mode",
    "title": "Dark Mode Implementation",
    "overview": "Implemented global dark mode toggle with theme persistence.",
    "overviewBullets": "Created ThemeProvider\nUpdated components\nAdded toggle in settings"
  }'
```

**If the API call fails**: Report the error and continue - logging failures are non-blocking.

## Screenshot Capture (Context-Related Only)

**Workflow**:

### Step 1: Check if Test Scenario Exists

```bash
curl -X POST "http://localhost:3000/api/tester/screenshot" \
  -H "Content-Type: application/json" \
  -d '{"contextId":"
    "contextId": "ctx_1771875422898_zecaf5p",","scanOnly":true}'
```

**If `hasScenario: false`**: Skip all remaining screenshot steps. Set `screenshot: null` in log.

### Step 2: Start Dev Server (ONLY if scenario exists)

```bash
npm run dev &
SERVER_PID=$!
sleep 8

# Verify server is running
if ! curl -I http://localhost:3000 2>/dev/null; then
  echo "❌ Server failed - check if your implementation broke the build"
  # Fix bugs if related to your changes, then retry
  # Otherwise continue without screenshot (screenshot: null)
fi
```

### Step 3: Capture Screenshot

```bash
curl -X POST "http://localhost:3000/api/tester/screenshot" \
  -H "Content-Type: application/json" \
  -d '{"contextId":"
    "contextId": "ctx_1771875422898_zecaf5p","}'
```

### Step 4: Stop Server (CRITICAL)

```bash
kill $SERVER_PID 2>/dev/null || true
sleep 2
# Force kill if still running
kill -9 $(lsof -ti:3000) 2>/dev/null || true
```

### Step 5: Update Log with Screenshot Path

Use the `screenshotPath` from API response in your log creation:

```typescript
screenshot: screenshotPath || null
```

**Error Handling**:
- No scenario → `screenshot: null`
- Server fails (unrelated to your code) → `screenshot: null`
- Server fails (your bugs) → Fix bugs, retry, then screenshot
- Screenshot API fails → `screenshot: null`
- **Always stop the server** to free the port for next task

## Final Checklist

Before finishing:
- [ ] All code changes implemented
- [ ] Test IDs added to interactive components
- [ ] File structure follows guidelines
- [ ] UI components match existing theme
- [ ] Implementation log entry created
- [ ] Screenshot captured (if test scenario exists)
- [ ] NO separate documentation files created (unless new major feature)

Begin implementation now.