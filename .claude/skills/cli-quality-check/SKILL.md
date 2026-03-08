# CLI Quality Check

Run integration quality tests across CLI providers (Claude, Gemini, Copilot) and evaluate both technical performance and business output quality.

## Usage

The user can scope tests via arguments or you can ask interactively.

**Shorthand examples:**
- `/cli-quality-check` — run all available providers with default models
- `/cli-quality-check claude copilot` — run only Claude and Copilot
- `/cli-quality-check claude:opus copilot:gpt-5.4` — specific models
- `/cli-quality-check --features persona-design,healing-diagnosis` — specific feature areas
- `/cli-quality-check --tier premium` — only premium-tier models

## Step 1: Parse Scope

Determine which providers, models, and feature areas to test. Map user input to env vars:

| User Input | Env Var | Values |
|---|---|---|
| Provider names | `CLI_TEST_PROVIDERS` | `claude`, `gemini`, `copilot` |
| Model IDs | `CLI_TEST_MODELS` | See model table below |
| Tier filter | `CLI_TEST_TIERS` | `budget`, `standard`, `premium` |
| Feature areas | `CLI_TEST_FEATURES` | See feature table below |

### Available Models

| Provider | Model ID | Label | Tier |
|---|---|---|---|
| Claude | `claude-sonnet-4-6` | Sonnet 4.6 | standard |
| Claude | `claude-haiku-4-5` | Haiku 4.5 | budget |
| Claude | `claude-opus-4-6` | Opus 4.6 | premium |
| Gemini | `gemini-2.5-flash-lite` | Flash Lite 2.5 | budget |
| Copilot | `gpt-5.1-codex-mini` | GPT-5.1 Codex Mini | budget |
| Copilot | `claude-sonnet-4.6` | Claude Sonnet 4.6 | standard |
| Copilot | `gpt-5.4` | GPT-5.4 | premium |

### Feature Areas

| Area | Description |
|---|---|
| `persona-design` | Generate system prompts from persona briefs |
| `credential-design` | Create setup guides from connector specs |
| `persona-testing` | Evaluate persona response quality |
| `credential-healthcheck` | Diagnose credential failures |
| `n8n-transform` | Analyze n8n workflows for persona mapping |
| `healing-diagnosis` | Root-cause analysis from error logs |
| `smart-search` | Trace data flows across multiple files |
| `recipe-generation` | Design automation recipes from requirements |
| `auto-cred-browser` | Guided credential setup |
| `automation-design` | Design automation pipelines |
| `credential-negotiation` | Negotiate credential access |

### Model shorthand

The user may use shorthand like `claude:opus` or `copilot:gpt-5.4`. Map these:
- `claude:sonnet` → `claude-sonnet-4-6`
- `claude:haiku` → `claude-haiku-4-5`
- `claude:opus` → `claude-opus-4-6`
- `copilot:codex` → `gpt-5.1-codex-mini`
- `copilot:sonnet` → `claude-sonnet-4.6`
- `copilot:gpt` → `gpt-5.4`

## Step 2: Check Provider Availability

Before running tests, verify that scoped providers are installed:

```bash
claude --version 2>/dev/null
gemini --version 2>/dev/null
copilot --version 2>/dev/null
```

Report which providers are available. If a requested provider is unavailable, warn the user and continue with available ones.

## Step 3: Run Tests

Execute the integration test suite with the scoped env vars:

```bash
CLI_TEST_PROVIDERS="{providers}" \
CLI_TEST_MODELS="{models}" \
CLI_TEST_TIERS="{tiers}" \
CLI_TEST_FEATURES="{features}" \
npx vitest run --config vitest.integration.config.ts src/test/integration/rounds/round8-feature-areas.integration.test.ts
```

For a broader run including foundation tests:
```bash
CLI_TEST_PROVIDERS="{providers}" \
npx vitest run --config vitest.integration.config.ts
```

## Step 4: Analyze Results

After tests complete, read the generated report:

```bash
cat src/test/integration/reports/integration-report.json
```

Parse the JSON and present results in this format:

### Quality Scorecard

For each provider/model combo tested, show:

```
Provider: {name} / {model}
  Overall Grade: {A-F} ({score}%)

  Technical Dimensions:
    Completion:      {score}% — {detail}
    Response Length:  {score}% — {detail}
    Tool Usage:      {score}% — {detail}
    Speed:           {score}% — {detail}

  Business Dimensions:
    {dimension}:     {score}% — {detail}
    ...

  Feature Area Results:
    persona-design:      PASS (Grade B, 78%)
    credential-design:   PASS (Grade A, 92%)
    healing-diagnosis:   FAIL (Grade D, 38%)
    ...
```

### Head-to-Head Comparison

If multiple providers/models were tested, create a comparison table:

```
Feature Area          | Claude Sonnet | Copilot GPT-5.4 | Winner
─────────────────────────────────────────────────────────────────
persona-design        | A (92%)       | B (78%)         | Claude
credential-design     | B (85%)       | A (90%)         | Copilot
healing-diagnosis     | A (95%)       | C (62%)         | Claude
```

### Recommendations

Based on the results, provide:
1. **Best provider per feature area** — which provider/model excels at each task
2. **Cost efficiency** — token usage and cost per feature area
3. **Outsourcing readiness** — which features can safely use non-Claude providers
4. **Risk areas** — features where alternative providers fall below acceptable quality

## Step 5: Save Report

Write the analysis to `src/test/integration/reports/quality-report-{timestamp}.md` for historical tracking.

## Notes

- Tests run sequentially to avoid rate limits
- Each test has a 180s timeout
- Tests use temporary workspaces that are cleaned up automatically
- The test database (SQLite) persists results for trend analysis
- Quality scores combine technical metrics (completion, speed, tool usage) with business metrics (domain accuracy, actionable output)
