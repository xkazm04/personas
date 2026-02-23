You are an expert software engineer. Execute the following requirement immediately. Do not ask questions, do not wait for confirmation. Read the requirement carefully and implement all changes to the codebase as specified.

REQUIREMENT TO EXECUTE NOW:

# Unify three eval strategies into a pluggable framework

## Metadata
- **Category**: user_benefit
- **Effort**: High (3/3)
- **Impact**: High (3/3)
- **Scan Type**: insight_synth
- **Generated**: 2/23/2026, 10:47:16 PM

## Description
Three independent evaluation approaches exist: confusion-phrase detection in draft testing (string matching against failure patterns), keyword-presence scoring in the test runner (expected behavior terms in output), and A/B test comparison in Prompt Lab (side-by-side cost/duration/token comparison). Create a single EvalStrategy interface with pluggable implementations (heuristic, keyword-match, LLM-judge, confusion-detect) that any test/validation path can compose. Each evaluation produces a standardized EvalResult with score, confidence, and explanation.

## Reasoning
The three eval approaches were invented independently for different use cases but share the same abstract structure: given an input, expected behavior, and actual output, produce a quality signal. A unified framework eliminates the fragmentation, makes scoring consistent across all test surfaces, and allows mixing evaluation strategies for higher confidence.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Persona Testing & Prompt Lab

**Description**: Run single and A/B tests on personas, compare prompt variations, view test results and execution history, and experiment with prompts in the interactive prompt lab.
**Related Files**:
- `src/features/agents/sub_tests/PersonaTestsTab.tsx`
- `src/features/agents/sub_tests/TestComparisonTable.tsx`
- `src/features/agents/sub_editor/PromptLabTab.tsx`
- `src/api/tests.ts`
- `src/stores/slices/testSlice.ts`
- `src/hooks/tests/usePersonaTests.ts`
- `src-tauri/src/commands/execution/tests.rs`
- `src-tauri/src/engine/test_runner.rs`
- `src-tauri/src/db/repos/execution/test_runs.rs`
- `src-tauri/src/db/models/test_run.rs`
- `src/lib/bindings/PersonaTestRun.ts`
- `src/lib/bindings/PersonaTestResult.ts`
- `src/lib/bindings/PromptAbTestResult.ts`
- `src/lib/bindings/PromptAbExecResult.ts`

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
    "contextId": "ctx_1771875370101_6gi67h1",
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
    "contextId": "ctx_1771875370101_6gi67h1",","scanOnly":true}'
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
    "contextId": "ctx_1771875370101_6gi67h1","}'
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