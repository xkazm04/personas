# Design 3: Scenario Capture & Replay Testing

> Solution overview for future implementation. This design becomes viable once enough
> persona executions have accumulated to provide a diverse replay library.

## Philosophy

Design 1 (Sandbox Testing with Mock Tool Responses) generates *synthetic* test scenarios
using a coordinator LLM. Design 3 takes the opposite approach: it captures *real*
execution data from production runs and replays them against different models. This
produces the most realistic test comparison possible because the scenarios, tool calls,
and expected outputs come from actual agent behavior.

## Prerequisites

- **Minimum execution history**: At least 10-20 successful executions per persona with
  recorded `tool_steps` data (already captured by the existing execution pipeline).
- **Tool step capture** (already implemented): Each execution records a JSON array of
  `ToolCallStep` objects with `tool_name`, `input_preview`, `output_preview`, and timing.
- **Execution flows** (already implemented): The `execution_flows` field captures the
  agent's structured output including protocol messages.

## Architecture

```
┌─ Phase 1: CAPTURE ─────────────────────────────────────┐
│  Automatically runs during every normal execution.      │
│  Already implemented via:                               │
│  • ToolCallStep recording in runner.rs                  │
│  • execution_flows JSON in persona_executions table     │
│  • execution output/error in persona_executions         │
│                                                         │
│  New: Extract & normalize into replay-ready format      │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─ Phase 2: LIBRARY ─────────────────────────────────────┐
│  persona_test_scenarios table (new)                     │
│  • scenario_id, persona_id, source_execution_id         │
│  • input_data (original input)                          │
│  • tool_call_sequence (ordered tool calls + responses)  │
│  • expected_output (captured from original execution)   │
│  • expected_protocols (extracted protocol messages)     │
│  • tags (auto-classified: "happy_path", "error_case")   │
│  • quality_score (auto-scored by model complexity)       │
│                                                         │
│  Auto-pruning: keep best N per tag per persona          │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─ Phase 3: REPLAY ──────────────────────────────────────┐
│  For each scenario × selected model:                    │
│  • Inject captured tool responses into persona prompt   │
│  • Run persona with target model                        │
│  • Capture output, tool call attempts, timing           │
│  (Same execution mechanism as Design 1, Phase 2)        │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─ Phase 4: DIFF & SCORE ────────────────────────────────┐
│  Compare replay output against original execution:      │
│  • Tool call sequence diff (same tools? same order?)    │
│  • Output similarity (semantic + keyword matching)      │
│  • Protocol compliance (same protocol messages emitted) │
│  • Performance delta (cost, speed)                      │
│  • Regression detection (did something get worse?)      │
└─────────────────────────────────────────────────────────┘
```

## Capture Mechanism

### What already exists

The execution pipeline (`engine/runner.rs`) already records:

```rust
// In ExecutionResult (engine/types.rs)
pub struct ExecutionResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub log_file_path: Option<String>,
    pub execution_flows: Option<String>,   // JSON: protocol messages
    pub tool_steps: Option<String>,        // JSON: Vec<ToolCallStep>
    pub session_limit_reached: bool,
}
```

And each `ToolCallStep` contains:

```rust
pub struct ToolCallStep {
    pub tool_name: String,
    pub tool_id: Option<String>,
    pub input_preview: Option<String>,
    pub output_preview: Option<String>,
    pub is_error: bool,
    pub duration_ms: Option<u64>,
}
```

### What needs to be added

A background process (or manual trigger) that:

1. Reads completed executions with `status = "completed"` and non-null `tool_steps`.
2. Extracts a normalized scenario from each execution:
   - `input_data` from `persona_executions.input_data`
   - `tool_call_sequence` from parsed `tool_steps` JSON
   - `expected_output` from `output_data`
   - `expected_protocols` from `execution_flows`
3. De-duplicates against existing scenarios (same input → same scenario).
4. Auto-tags based on heuristics (error handling, multi-tool, single-tool, etc.).
5. Scores scenario quality (more tool calls = more interesting test).
6. Writes to `persona_test_scenarios` table.

## Scenario Library Schema

```sql
CREATE TABLE IF NOT EXISTS persona_test_scenarios (
    id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    source_execution_id TEXT REFERENCES persona_executions(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    input_data TEXT,                  -- JSON: original input
    tool_call_sequence TEXT NOT NULL, -- JSON: [{tool_name, input, output}]
    expected_output TEXT,             -- Original agent output
    expected_protocols TEXT,          -- JSON: extracted protocol messages
    tags TEXT NOT NULL DEFAULT '[]',  -- JSON array of tags
    quality_score INTEGER NOT NULL DEFAULT 50,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_scenarios_persona ON persona_test_scenarios(persona_id);
```

## Replay Engine

The replay engine shares most of its implementation with Design 1's Phase 2:

1. **Build prompt**: Same `prompt::assemble_prompt()` call.
2. **Inject mock tools**: Convert `tool_call_sequence` into the same `## SANDBOX TESTING MODE`
   section that Design 1 uses. The mock responses come from captured `output_preview` fields.
3. **Execute**: Same `spawn_cli_and_collect_structured()` function.
4. **Score**: Enhanced scoring adds a **diff engine** layer on top of the basic scoring.

## Diff Engine

The diff engine compares the replay output against the original captured output:

### Tool Call Diff
- **Sequence matching**: Longest Common Subsequence (LCS) of tool call names.
- **Input matching**: Compare tool call inputs (normalized JSON diff).
- **Score**: `LCS_length / max(expected_length, actual_length) * 100`

### Output Similarity
- **Keyword overlap**: Jaccard similarity of significant tokens.
- **Structure match**: If output is JSON, compare keys and structure.
- **Semantic distance**: Optional — use embedding similarity if available.

### Regression Detection
Compare scores against the *original model's baseline*:
- If a cheaper model achieves >= 90% of the original score → **good candidate**.
- If the same model scores lower than before → **regression detected**.
- Track score trends across test runs for drift detection.

## UI Integration

The replay testing UI can reuse the same Tests tab from Design 1 with an additional section:

```
┌─ Tests Tab ─────────────────────────────────────────────┐
│                                                          │
│  [Sandbox Test Runner]     ← Design 1 (already built)   │
│  [Replay Test Runner]      ← Design 3 (new section)     │
│                                                          │
│  Scenario Library:                                       │
│  • Auto-captured from executions                         │
│  • Pin/unpin scenarios                                   │
│  • Filter by tag                                         │
│  • Manual scenario creation (paste input/output)         │
│                                                          │
│  [Test History]            ← shared results table        │
└──────────────────────────────────────────────────────────┘
```

## Implementation Milestones

### Milestone 1: Scenario Capture
- Add `persona_test_scenarios` table
- Background job to extract scenarios from completed executions
- Basic auto-tagging and quality scoring
- UI to view/pin/delete scenarios

### Milestone 2: Replay Execution
- Replay engine (reuses Design 1's CLI spawn infrastructure)
- Convert captured tool calls to mock format
- Execute and score against captured baseline

### Milestone 3: Diff Engine
- Tool call sequence diff (LCS-based)
- Output similarity scoring
- Regression detection alerts

### Milestone 4: Continuous Testing
- Automatic replay on model config change
- Regression alerts in the healing system
- Score trend visualization over time

## Key Advantages Over Design 1

| Aspect | Design 1 (Sandbox) | Design 3 (Capture & Replay) |
|--------|--------------------|-----------------------------|
| Scenario source | LLM-generated | Real execution data |
| Coverage | Hypothetical cases | Proven real-world cases |
| Mock quality | Synthetic tool responses | Actual API responses |
| Baseline | Expected behavior description | Actual agent output |
| Prerequisites | None (works immediately) | Needs execution history |
| Regression detection | No (no baseline) | Yes (compare against original) |

## When to Implement

This design should be revisited when:
- Most personas have 20+ completed executions with tool_steps data
- Users request regression testing or model migration validation
- The team wants to validate prompt changes against historical behavior

The Design 1 sandbox testing infrastructure (mock injection, CLI spawn, scoring engine)
provides the foundation that Design 3 builds upon.
