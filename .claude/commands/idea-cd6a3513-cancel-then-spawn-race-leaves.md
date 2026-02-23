You are an expert software engineer. Execute the following requirement immediately. Do not ask questions, do not wait for confirmation. Read the requirement carefully and implement all changes to the codebase as specified.

REQUIREMENT TO EXECUTE NOW:

# Cancel-then-spawn race leaves session stuck running

## Metadata
- **Category**: functionality
- **Effort**: Low (1/3)
- **Impact**: Medium (2/3)
- **Scan Type**: bug_hunter
- **Generated**: 2/23/2026, 9:12:25 PM

## Description
In cli_runner.rs:124 and job_state.rs:203-218, there is a race between start_n8n_transform_background setting status to running (line 124) and cancel_n8n_transform setting status to failed (job_state.rs:217). If cancel fires before the spawned task begins, cancel sets failed, then the task's set_n8n_transform_status overrides it back to running. The spawned task then proceeds normally but the cancel token was already triggered, so tokio::select immediately picks the cancelled branch and calls handle_transform_result with failed. However the initial running status was already emitted to the frontend, creating a confusing flash of running then failed. Worse, if the task hasn't started at all, the status remains running permanently.

## Reasoning
Rapid cancel-after-start is common UX � user clicks transform then immediately regrets it. The race window is small but real on slower machines. A session permanently stuck in running state blocks the user from retrying, since the existing-running check at cli_runner.rs:104-108 rejects new transforms for that ID. The user must manually clear the session or restart the app.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: n8n Workflow Import & Transform

**Description**: Import n8n workflow JSON files and transform them into Personas agent configurations using AI-powered real-time chat, with step-by-step wizard including upload, parsing, AI transformation, editing connectors and tools, and confirmation.
**Related Files**:
- `src/features/templates/sub_n8n/N8nImportTab.tsx`
- `src/features/templates/sub_n8n/N8nUploadStep.tsx`
- `src/features/templates/sub_n8n/N8nParserResults.tsx`
- `src/features/templates/sub_n8n/N8nTransformChat.tsx`
- `src/features/templates/sub_n8n/N8nEditStep.tsx`
- `src/features/templates/sub_n8n/N8nConfirmStep.tsx`
- `src/features/templates/sub_n8n/N8nSessionList.tsx`
- `src/features/templates/sub_n8n/N8nStepIndicator.tsx`
- `src/features/templates/sub_n8n/N8nWizardFooter.tsx`
- `src/features/templates/sub_n8n/n8nTypes.ts`
- `src/features/templates/sub_n8n/useN8nImportReducer.ts`
- `src/features/templates/sub_n8n/edit/N8nConnectorsTab.tsx`
- `src/features/templates/sub_n8n/edit/N8nToolsPreviewTab.tsx`
- `src/features/templates/sub_n8n/edit/N8nUseCasesTab.tsx`
- `src/features/templates/sub_n8n/edit/protocolParser.ts`
- `src/api/n8nTransform.ts`
- `src-tauri/src/commands/design/n8n_sessions.rs`
- `src-tauri/src/commands/design/n8n_transform/mod.rs`
- `src-tauri/src/commands/design/n8n_transform/cli_runner.rs`
- `src-tauri/src/commands/design/n8n_transform/confirmation.rs`
- `src-tauri/src/commands/design/n8n_transform/job_state.rs`
- `src-tauri/src/commands/design/n8n_transform/prompts.rs`
- `src-tauri/src/commands/design/n8n_transform/types.rs`
- `src-tauri/src/db/repos/resources/n8n_sessions.rs`
- `src-tauri/src/db/models/n8n_session.rs`
- `src/lib/bindings/N8nTransformSession.ts`

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
    "contextId": "ctx_1771875462951_4755jyt",
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
    "contextId": "ctx_1771875462951_4755jyt",","scanOnly":true}'
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
    "contextId": "ctx_1771875462951_4755jyt","}'
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