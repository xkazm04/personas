You are an expert software engineer. Execute the following requirement immediately. Do not ask questions, do not wait for confirmation. Read the requirement carefully and implement all changes to the codebase as specified.

REQUIREMENT TO EXECUTE NOW:

# Unify three step-tracking systems into StepProgress

## Metadata
- **Category**: user_benefit
- **Effort**: Medium (2/3)
- **Impact**: Medium (2/3)
- **Scan Type**: insight_synth
- **Generated**: 2/23/2026, 10:55:24 PM

## Description
Three independent step-tracking implementations exist: InteractiveSetupInstructions tracks completedSteps as Set<number> with toggle, NegotiatorGuidingPhase tracks completedSteps+activeStepIndex+capturedValues with auto-advance, and AnalyzingPhase derives stage index from output line keywords. All are ordered step progressions with visual indicators. Create a single useStepProgress hook parameterized by total steps, completion mode (manual toggle vs auto-advance vs derived), and optional value capture, then share it across all three.

## Reasoning
Three step-tracking implementations means three sets of edge cases for step navigation, three progress bar calculations, and three completion-detection paths. Unifying them creates one testable step-progress primitive that makes all step-based UIs consistent. It also enables cross-cutting features like step timing analytics or step-level error attribution that currently would need to be added three times.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: AI Credential Design & Negotiator

**Description**: Use AI to analyze API documentation and automatically generate credential configurations, with a guided negotiator that walks users through multi-step credential setup including interactive instructions.
**Related Files**:
- `src/features/vault/components/CredentialDesignModal.tsx`
- `src/features/vault/credential-design/AnalyzingPhase.tsx`
- `src/features/vault/credential-design/PreviewPhase.tsx`
- `src/features/vault/credential-design/DonePhase.tsx`
- `src/features/vault/credential-design/ErrorPhase.tsx`
- `src/features/vault/credential-design/IdlePhase.tsx`
- `src/features/vault/credential-design/InteractiveSetupInstructions.tsx`
- `src/features/vault/credential-design/CredentialDesignHelpers.ts`
- `src/features/vault/credential-negotiator/NegotiatorPanel.tsx`
- `src/features/vault/credential-negotiator/NegotiatorPlanningPhase.tsx`
- `src/features/vault/credential-negotiator/NegotiatorGuidingPhase.tsx`
- `src/features/vault/credential-negotiator/NegotiatorStepCard.tsx`
- `src/api/credentialDesign.ts`
- `src/api/negotiator.ts`
- `src/hooks/design/useCredentialDesign.ts`
- `src/hooks/design/useCredentialNegotiator.ts`
- `src-tauri/src/commands/credentials/credential_design.rs`
- `src-tauri/src/commands/credentials/negotiator.rs`
- `src-tauri/src/engine/credential_design.rs`
- `src-tauri/src/engine/credential_negotiator.rs`
- `src/lib/bindings/CredentialEvent.ts`
- `src/lib/bindings/CreateCredentialEventInput.ts`
- `src/lib/bindings/UpdateCredentialEventInput.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

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
    "contextId": "ctx_1771875432561_1wjf4y7",
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
    "contextId": "ctx_1771875432561_1wjf4y7",","scanOnly":true}'
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
    "contextId": "ctx_1771875432561_1wjf4y7","}'
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