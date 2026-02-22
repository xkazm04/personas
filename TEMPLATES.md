# TEMPLATES.md

Canonical reference for the **Template System** in Personas Desktop. This document defines how templates are generated, structured, tested, and adopted as live Personas.

---

## What is a Template?

A Template is a **pre-configured persona blueprint** produced by AI design analysis. It contains a complete `DesignAnalysisResult` — structured prompt sections, suggested tools, triggers, connectors, notification channels, event subscriptions, and a feasibility assessment. Templates are not live agents; they become Personas through the **adoption** process.

---

## Template Types

### 1. Built-in Templates

Pre-packaged JSON files in `scripts/templates/` that ship with the application. Each wraps a `DesignAnalysisResult` with metadata (name, icon, color, category). Displayed in the **Built-in Templates** tab.

**Type**: `BuiltinTemplate` (`src/lib/types/templateTypes.ts`)

### 2. n8n Import Templates

n8n workflow JSON files transformed into persona configurations via `src-tauri/src/commands/design/n8n_transform.rs`. n8n nodes map to persona tools; connections map to triggers.

**Tab**: n8n Import

### 3. AI-Generated Templates

Produced by running **design review test cases** against the design engine. Each test case (an instruction string) is analyzed by Claude, which generates a full `DesignAnalysisResult`. Results are stored as `PersonaDesignReview` database records.

**Tab**: Generated

---

## Generation Process

### Step 1: Initiate Review Run

User clicks **Generate Templates** in the Generated tab, opening the `DesignReviewRunner` modal.

### Step 2: Select Test Cases

Two modes:
- **Predefined** — 5 built-in test cases covering common patterns (Gmail filter, GitHub PR reviewer, Calendar digest, Webhook processor, Multi-agent coordinator)
- **Custom** — User enters instructions manually or uploads a `.txt`/`.md` file

### Step 3: Backend Execution

For each test case, the backend:
1. Sends the instruction to the design engine (`src-tauri/src/engine/design.rs`)
2. Claude generates a `DesignAnalysisResult` with structured prompt, tools, triggers, connectors
3. The result is evaluated for structural completeness and semantic quality (scored 0–100)
4. A `PersonaDesignReview` record is saved with status `passed`, `failed`, or `error`

Progress is streamed via `design-review-status` Tauri events.

### Step 4: Quality Scoring

Each template receives two scores:
- **Structural Score** — Does the output have all required sections? (identity, instructions, tools, etc.)
- **Semantic Score** — Is the content meaningful, specific, and actionable?

The **Quality** column displays the average: `(structural + semantic) / 2`

### Step 5: Connector Readiness Assessment

After generation, each template's required connectors are checked against the current system state:
- **Ready** (green) — Connector installed and credential exists
- **Partial** (amber) — Some connectors missing credentials
- **Setup needed** (red) — Required connectors not installed

Readiness is derived client-side by comparing `suggested_connectors` against `connectorDefinitions` and `credentials` from the store.

---

## Adoption Process (CLI-Driven, Unified Prompt Architecture)

Adoption converts a template into a live Persona using **Claude Code CLI** for intelligent analysis and customization. This follows the same unified prompt architecture as n8n workflow import (`sub_n8n`), where a single Claude Sonnet session decides whether to ask clarifying questions or generate a persona directly.

### Architecture Overview

```
User clicks "Adopt"
  → AdoptionWizardModal opens (overview step)
  → User clicks "Customize with AI"
  → Frontend generates UUID adoptId, calls startTemplateAdoptBackground()
  → Rust backend spawns Claude CLI with unified prompt (Turn 1)
  → Claude analyzes the DesignAnalysisResult and decides:
    ├─ Simple template → generates persona JSON directly
    │   → Backend parses draft, sets status "completed"
    │   → Frontend transitions to edit step
    └─ Complex template → outputs TRANSFORM_QUESTIONS marker + JSON array
        → Backend stores questions in snapshot, sets status "awaiting_answers"
        → Backend captures Claude session ID for Turn 2
        → Frontend polls snapshot → detects awaiting_answers → shows configure step
        → User answers questions → clicks "Continue with Answers"
        → Frontend calls continueTemplateAdopt(adoptId, userAnswersJson)
        → Backend resumes same Claude session (Turn 2) with --resume <session_id>
        → Claude generates persona JSON using answers + prior context
        → Backend parses draft, sets status "completed"
        → Frontend transitions to edit step
  → User reviews/edits the draft or requests AI adjustments
  → User confirms → confirmTemplateAdoptDraft() creates Persona
```

### Step 1: Overview

Clicking **Adopt** opens the `AdoptionWizardModal`. The overview step displays:
- Template summary and description
- Stat pills: connector count, tool count, trigger count, channel count
- Connector readiness status (which integrations are ready vs. need setup)
- Info note explaining that Claude will analyze and customize the template

### Step 2: AI Transform (Unified Prompt — Turn 1)

The user clicks **Customize with AI**. The backend:
1. Spawns `claude -p - --output-format stream-json --verbose --model claude-sonnet-4-6` as a subprocess
2. Sends a **unified prompt** that instructs Claude to analyze the template and decide:
   - If the template is complex (external services, multiple connectors, ambiguous choices) → ask 4-8 clarifying questions
   - If the template is simple and self-explanatory → generate the persona directly
3. Captures the Claude session ID from stream-json events for possible Turn 2

**If questions are produced**: The output contains a `TRANSFORM_QUESTIONS` marker followed by a JSON array. The backend stores the questions in the snapshot and sets status to `awaiting_answers`. The frontend detects this via snapshot polling and transitions to the configure step.

**If persona is produced directly**: Claude skips questions and generates the full persona JSON. The backend parses it and sets status to `completed`. The frontend transitions directly to the edit step.

### Step 2b: Configure (Interactive Questions)

When Turn 1 produces questions, the frontend shows the `ConfigureStep` component with questions across these categories:
1. **Credential Mapping** — which credentials for each service referenced in the template
2. **Configuration Parameters** — template-specific settings to customize
3. **Human-in-the-Loop** — for actions with external consequences, whether to require manual approval
4. **Memory & Learning** — what the persona should remember across runs for self-improvement
5. **Notification Preferences** — how the persona should notify the user

The user fills in answers and clicks **Continue with Answers**. The frontend calls `continueTemplateAdopt(adoptId, userAnswersJson)` which resumes the same Claude session (Turn 2) using `--resume <session_id>`. Claude receives the answers and generates the full persona JSON.

Users can also **Skip** the questions to proceed with default/empty answers.

### Step 2c: AI Transform (Turn 2 — Session Continuation)

Turn 2 resumes the original Claude session using the captured session ID. The prompt provides the user's answers and instructs Claude to proceed to PHASE 2 (persona generation). Since the session retains context from Turn 1's analysis, the generated persona incorporates both the original template analysis and the user's specific preferences.

### Adjustment Re-runs

When a user requests adjustments to an existing draft (via the edit step's "Apply Adjustments" button), the backend uses the **direct transform prompt** (not the unified prompt). Adjustment re-runs skip question generation entirely and use a single-prompt path that includes the previous draft JSON and adjustment request text.

During transform, the UI shows:
- Streaming CLI output lines (via `N8nTransformProgress` component)
- Phase indicator (running / completed / failed / awaiting_answers)
- Cancel button to abort the CLI subprocess

**Background processing**: The user can close the modal while the CLI is running — processing continues in the background. A banner in the Generated tab indicates an active adoption. Re-opening the wizard auto-restores the session from localStorage + backend snapshot polling.

**Session persistence**: The adoption context (adoptId, templateName, designResultJson, savedAt) is stored in localStorage with a 10-minute staleness TTL. If the user navigates away and returns, snapshot polling via `getTemplateAdoptSnapshot()` recovers the session state. Stale contexts (older than 10 minutes) are automatically discarded.

**Global flag**: `templateAdoptActive` in the Zustand uiSlice tracks whether a background adoption is running. This drives the banner in `GeneratedReviewsTab` and is cleared when the transform completes, fails, or is cancelled.

### Step 3: Edit Draft (Shared DraftEditStep)

After the transform completes, the user enters the **DraftEditStep** — a rich tabbed editor shared between template adoption and n8n import. This replaces the earlier inline form fields with a production-grade editing experience.

The editor provides 4 tabs:
- **Identity** — Name, description, system prompt (edit/preview toggle), and design context. Uses subtab navigation with `SectionEditor` for markdown editing with live preview.
- **Prompt** — Structured prompt editing across 6 sections: identity, instructions, tool guidance, examples, error handling, and custom sections. Content indicators (green dots) show which sections have content. Custom sections support add/delete/reorder.
- **Settings** — Appearance (icon text + color picker), limits (budget, turns), and model profile. Uses a clean card layout with labeled form groups.
- **JSON** — Raw JSON editor with real-time validation. Changes here override form fields; the draft is re-parsed on every edit.

At the bottom, an **AI Adjustments** panel lets the user describe desired changes and re-run the CLI transform, with the current draft and adjustment text as context.

The persona quick preview at the top shows the current icon, name, and description, updating in real-time as the user edits.

### Step 4: Confirm & Create (AdoptConfirmStep)

The confirm step shows a **rich persona preview card** (matching the n8n confirm step design):
- Persona icon, name, and description with styled card layout
- **Entity summary grid** — tool, trigger, connector, and channel counts from the design result
- **Item tags** — tool names and trigger types displayed as inline badges
- **Connector warnings** — connectors needing credential setup highlighted in amber
- **Collapsible system prompt preview** — expand to review the full prompt
- **Success animation** — spring-animated checkmark with creation details after persona is saved

The user clicks **Create Persona**. The backend `confirm_template_adopt_draft` command:
1. Parses the `N8nPersonaDraft` JSON
2. Creates a new `Persona` record with all fields populated
3. Returns the new persona, which appears in the sidebar

Post-adoption, the user can further customize the persona, configure connectors, and adjust triggers from the persona detail view.

### CLI Prompt Design

Two prompt variants are used:

**Unified Prompt** (`build_template_adopt_unified_prompt`) — Used for initial transforms. Instructs Claude to:
1. Analyze the template's complexity and decide whether to ask questions or generate directly
2. If complex: output `TRANSFORM_QUESTIONS` marker + JSON question array, then stop
3. If simple: generate the full persona JSON directly
4. Preserve the structured prompt architecture (identity, instructions, toolGuidance, examples, errorHandling, customSections)
5. Embed protocol messages (user_message, agent_memory, manual_review) for human-in-the-loop and memory
6. Add customSections for "Human-in-the-Loop" and "Memory Strategy" when appropriate

**Direct Transform Prompt** (`build_template_adopt_prompt`) — Used for adjustment re-runs. Instructs Claude to:
1. Refine the previous draft with the user's adjustment request and configuration answers
2. Preserve the same structured prompt architecture
3. Apply all protocol message instructions
4. Return a valid JSON object with the `N8nPersonaDraft` shape

**Session Continuation** (`continue_template_adopt`) — Turn 2 uses `--resume <session_id>` to continue the Claude session from Turn 1. The prompt provides the user's answers and asks Claude to proceed to PHASE 2 (persona generation). The session retains context from the original template analysis.

### Event Streaming

Two Tauri event types drive the real-time UI:

| Event | Payload | Purpose |
|-------|---------|---------|
| `template-adopt-output` | `{ adopt_id, line }` | Per-line CLI output for streaming display |
| `template-adopt-status` | `{ adopt_id, status, error }` | Status transitions (running → completed/failed) |

The frontend uses `useCorrelatedCliStream` (same hook as n8n import) with `idField: 'adopt_id'` to correlate events to the active adoption session.

---

## Schema Reference

### DesignAnalysisResult

The core output from design analysis. Stored as JSON in `PersonaDesignReview.design_result`.

```typescript
interface DesignAnalysisResult {
  structured_prompt: {
    identity: string;
    instructions: string;
    toolGuidance: string;
    examples: string;
    errorHandling: string;
    customSections: Array<{ key: string; label: string; content: string }>;
  };
  suggested_tools: string[];
  suggested_triggers: Array<{
    trigger_type: "manual" | "schedule" | "polling" | "webhook";
    config: Record<string, unknown>;
    description: string;
  }>;
  suggested_connectors?: Array<{
    name: string;
    setup_url?: string;
    setup_instructions?: string;
    oauth_type?: string;
    credential_fields?: Array<{ key: string; label: string; type: string; ... }>;
    related_tools?: string[];
    related_triggers?: number[];
  }>;
  suggested_notification_channels?: Array<{
    type: "slack" | "telegram" | "email";
    description: string;
    required_connector: string;
    config_hints: Record<string, string>;
  }>;
  suggested_event_subscriptions?: Array<{
    event_type: string;
    source_filter?: Record<string, unknown>;
    description: string;
  }>;
  full_prompt_markdown: string;
  summary: string;
  design_highlights?: Array<{ category: string; icon: string; color: string; items: string[] }>;
  feasibility?: { confirmed_capabilities: string[]; issues: string[]; overall_feasibility: "ready" | "partial" | "blocked" };
}
```

### N8nPersonaDraft (Adoption Output)

The draft shape produced by the CLI during adoption. Shared with n8n import.

```typescript
interface N8nPersonaDraft {
  name: string | null;
  description: string | null;
  system_prompt: string;
  structured_prompt: Record<string, unknown> | null;
  icon: string | null;
  color: string | null;
  model_profile: string | null;
  max_budget_usd: number | null;
  max_turns: number | null;
  design_context: string | null;
}
```

### TemplateAdoptSnapshot (Backend State)

In-memory snapshot polled by the frontend for session recovery and question delivery.

```typescript
interface TemplateAdoptSnapshot {
  adopt_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
  questions: TransformQuestionResponse[] | null;
}
```

The `awaiting_answers` status indicates that Turn 1 produced questions. The `questions` field contains the question array. The frontend polls this snapshot and transitions to the configure step when questions are detected.

### PersonaDesignReview (Database Record)

```typescript
type PersonaDesignReview = {
  id: string;
  test_case_id: string;
  test_case_name: string;
  instruction: string;
  status: string;                    // "passed" | "failed" | "error"
  structural_score: number | null;
  semantic_score: number | null;
  connectors_used: string | null;    // JSON string[]
  trigger_types: string | null;      // JSON string[]
  design_result: string | null;      // JSON DesignAnalysisResult
  use_case_flows: string | null;     // JSON UseCaseFlow[]
  suggested_adjustment: string | null;
  test_run_id: string;
  reviewed_at: string;
};
```

---

## UI Architecture

### Component Tree

```
DesignReviewsPage
├── PassRateGauge
├── ReviewTimeline
├── ConnectorDropdown (filter)
├── BuiltinTemplatesTab
├── N8nImportTab
│   ├── N8nStepIndicator (animated step progress)
│   ├── N8nWizardFooter (data-driven footer)
│   ├── N8nUploadStep
│   ├── N8nParserResults / N8nConfigureStep
│   ├── N8nTransformProgress (shared streaming display)
│   ├── N8nEditStep (wraps DraftEditStep + adds Tools tab)
│   └── N8nConfirmStep
├── GeneratedReviewsTab
│   ├── ConnectorReadiness (per-row readiness indicator)
│   ├── ReviewExpandedDetail
│   ├── RowActionMenu
│   └── AdoptionWizardModal (CLI-driven wizard)
│       ├── useAdoptReducer (state machine: overview → transform → [configure →] edit → confirm)
│       ├── useCorrelatedCliStream (event streaming hook)
│       ├── ConnectorReadiness (overview step)
│       ├── N8nTransformProgress (shared streaming display)
│       ├── DraftEditStep (shared tabbed editor — identity/prompt/settings/json)
│       └── AdoptConfirmStep (rich persona preview with entity grid)
├── DesignReviewRunner (generation modal)
│   └── DesignTerminal
└── ActivityDiagramModal

Shared Draft Editor (features/shared/components/draft-editor/)
├── DraftEditStep (orchestrator: tab bar + content + adjustment panel)
├── DraftIdentityTab (name, description, system prompt, design context)
├── DraftPromptTab (6-section structured prompt editor)
├── DraftSettingsTab (appearance, limits, model)
├── DraftJsonTab (raw JSON with validation)
└── SectionEditor (edit/preview toggle for markdown)
```

### DesignResultPreview (used in persona design flow)

```
DesignResultPreview
├── PromptTabsPreview
│   └── MarkdownRenderer (per-tab content)
├── ConnectorsSection (integrations + tools)
├── EventsSection (triggers + subscriptions)
├── MessagesSection (notification channels)
└── DesignTestResults (feasibility)
```

### Data Flow

```
User clicks "Generate"
  → DesignReviewRunner modal opens
  → User selects test cases
  → startDesignReviewRun(personaId, testCases) API call
  → Backend emits design-review-status events
  → useDesignReviews hook tracks progress
  → Results saved to DB, shown in GeneratedReviewsTab

User clicks "Adopt"
  → AdoptionWizardModal opens (overview step)
  → User clicks "Customize with AI"
  → startTemplateAdoptBackground(adoptId, templateName, designResultJson) API call
  → Rust spawns Claude CLI with unified prompt (Turn 1)
  → CLI output streamed via template-adopt-output Tauri events
  → useCorrelatedCliStream captures lines in real-time
  → Backend captures session_id from stream-json events
  → If questions produced:
    → Backend stores questions in snapshot, sets status "awaiting_answers"
    → Frontend polls → detects awaiting_answers → shows ConfigureStep
    → User answers → clicks "Continue with Answers"
    → continueTemplateAdopt(adoptId, userAnswersJson) API call
    → Rust resumes Claude session (Turn 2) with --resume <session_id>
  → On completion: backend parses JSON → N8nPersonaDraft stored in snapshot
  → Frontend polls getTemplateAdoptSnapshot() → transitions to edit step
  → User edits draft fields or requests AI adjustments (re-runs CLI with direct prompt)
  → User confirms → confirmTemplateAdoptDraft(draftJson) API call
  → Backend creates Persona from draft
  → onPersonaCreated callback refreshes sidebar
```

### Key Files

| File | Purpose |
|------|---------|
| `src/features/templates/components/DesignReviewsPage.tsx` | Main page container with tabs |
| `src/features/templates/sub_generated/GeneratedReviewsTab.tsx` | Template table with readiness and adoption |
| `src/features/templates/sub_generated/DesignResultPreview.tsx` | Design result display with 3 separated sections |
| `src/features/templates/sub_generated/AdoptionWizardModal.tsx` | CLI-driven adoption wizard (4-step) |
| `src/features/templates/sub_generated/AdoptConfirmStep.tsx` | Rich persona preview for adoption confirm step |
| `src/features/templates/sub_generated/useAdoptReducer.ts` | Adoption state machine (overview → transform → edit → confirm) |
| `src/features/templates/sub_generated/ConnectorReadiness.tsx` | Readiness indicator component |
| `src/features/templates/sub_generated/DesignReviewRunner.tsx` | Generation test runner modal |
| `src/features/shared/components/draft-editor/DraftEditStep.tsx` | **Shared** tabbed persona editor (identity/prompt/settings/json + extensible) |
| `src/features/shared/components/draft-editor/DraftIdentityTab.tsx` | **Shared** identity editing with subtabs |
| `src/features/shared/components/draft-editor/DraftPromptTab.tsx` | **Shared** structured prompt editor (6 sections + custom) |
| `src/features/shared/components/draft-editor/DraftSettingsTab.tsx` | **Shared** appearance, limits, model settings |
| `src/features/shared/components/draft-editor/DraftJsonTab.tsx` | **Shared** raw JSON editor with validation |
| `src/features/shared/components/draft-editor/SectionEditor.tsx` | **Shared** edit/preview markdown toggle |
| `src/features/templates/sub_n8n/N8nEditStep.tsx` | Thin wrapper: DraftEditStep + n8n Tools tab |
| `src/features/templates/sub_n8n/N8nConfirmStep.tsx` | n8n-specific confirm with tool/trigger/connector selection |
| `src/features/templates/sub_n8n/n8nTypes.ts` | Draft normalization utilities (shared by both flows) |
| `src-tauri/src/commands/design/template_adopt.rs` | Rust backend: CLI spawn, event streaming, snapshot, confirmation |
| `src/api/design.ts` | TypeScript API layer (includes template adopt functions) |
| `src/hooks/execution/useCorrelatedCliStream.ts` | Generic CLI event streaming hook (shared with n8n) |
| `src/hooks/design/useDesignReviews.ts` | Hook for review CRUD and generation |
| `src/lib/types/designTypes.ts` | Core design analysis types |
| `src/features/shared/components/MarkdownRenderer.tsx` | Styled markdown rendering |

---

## Shared Component Architecture

### Philosophy: Extract on Second Use

The n8n import and template adoption flows are architecturally parallel — both transform external data into Persona drafts via CLI-driven AI analysis. Rather than duplicating UI code, shared components are extracted when functionality is needed by both flows.

**Extraction criteria**: A component is extracted to `features/shared/` when:
1. It takes generic props (e.g., `N8nPersonaDraft`, `updateDraft` callback) rather than flow-specific state
2. Both n8n import and template adoption need the same editing/display capability
3. The component can be extended via props (e.g., `additionalTabs`) for flow-specific variations

**What stays flow-specific**:
- State machines (`useN8nImportReducer`, `useAdoptReducer`) — different step sequences and state shapes
- Orchestrator containers (`N8nImportTab`, `AdoptionWizardModal`) — different layout (page tab vs. modal), lifecycle, and persistence logic
- Flow-specific UI (`N8nConfirmStep` with tool/trigger selection; `AdoptConfirmStep` with design result entities)
- n8n-specific components (`N8nToolsPreviewTab`, `N8nConfigureStep`, `N8nParserResults`)

### DraftEditStep Pattern

The `DraftEditStep` is the core shared component. It provides:

```
┌─────────────────────────────────────────────────┐
│ [Icon] Persona Name                             │  ← Quick preview (live-updating)
│         Description text                        │
├─────────────────────────────────────────────────┤
│ [Identity] [Prompt] [Settings] [...extra] [JSON]│  ← Tab bar
├─────────────────────────────────────────────────┤
│                                                 │
│   Tab content with AnimatePresence transitions  │  ← Content area
│                                                 │
├─────────────────────────────────────────────────┤
│ ✨ Request AI Adjustments                       │  ← Adjustment panel
│ [textarea]                        [Apply]       │
└─────────────────────────────────────────────────┘
```

**Extensibility via `additionalTabs`**: Flow-specific tabs are injected between Settings and JSON. For example, `N8nEditStep` adds a "Tools" tab showing the parsed workflow's tools/triggers/connectors. Template adoption uses the base 4 tabs directly.

```typescript
// n8n: adds a Tools tab
<DraftEditStep additionalTabs={[{ id: 'tools', label: 'Tools', Icon: Wrench, content: <N8nToolsPreviewTab /> }]} />

// adoption: uses base tabs directly
<DraftEditStep draft={state.draft} ... />
```

### Shared vs. Domain-Specific Components

| Layer | Shared (draft-editor/) | n8n-specific (sub_n8n/) | Adoption-specific (sub_generated/) |
|-------|------------------------|------------------------|------------------------------------|
| **Edit orchestrator** | `DraftEditStep` | `N8nEditStep` (wrapper) | Direct `DraftEditStep` usage |
| **Identity editing** | `DraftIdentityTab` | — | — |
| **Prompt editing** | `DraftPromptTab` | — | — |
| **Settings editing** | `DraftSettingsTab` | — | — |
| **JSON editing** | `DraftJsonTab` | — | — |
| **Markdown editor** | `SectionEditor` | — | — |
| **Transform display** | `N8nTransformProgress` | (owns) | (imports from sub_n8n) |
| **Tools preview** | — | `N8nToolsPreviewTab` | — |
| **Confirm step** | — | `N8nConfirmStep` | `AdoptConfirmStep` |
| **Step indicator** | — | `N8nStepIndicator` | Progress bar (inline) |
| **Footer** | — | `N8nWizardFooter` | Data-driven footer (inline) |
| **CLI streaming** | `useCorrelatedCliStream` | (imports from hooks/) | (imports from hooks/) |
| **Draft utilities** | — | `n8nTypes.ts` (normalize, stringify) | (imports from sub_n8n) |

### Background Processing Pattern

Both flows support closing the UI while CLI processing continues:

1. **Global flag** (`n8nTransformActive` / `templateAdoptActive`) in the Zustand `uiSlice` — drives status indicators in parent tabs
2. **localStorage persistence** with `savedAt` timestamp and 10-minute staleness TTL
3. **Backend snapshot polling** every 1.5s via `get*Snapshot()` API calls
4. **`hasRestoredRef`** guard to prevent restoration loops on mount
5. **`isRestoring`** state passed to `N8nTransformProgress` for "Reconnecting..." display
6. **Terminal state cleanup** — stop polling, clear localStorage, reset flags on completed/failed
