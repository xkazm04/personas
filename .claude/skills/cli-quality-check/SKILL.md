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

---

## Coordination — Active-Runs Ledger

`/cli-quality-check` is mostly **integration-test execution** — it reads code and runs tests, with optional fix-up commits when failures are clearly attributable to source bugs. Register only when you intend to commit fix-ups; pure test execution doesn't need registration. Per the convention in [`CLAUDE.md` → Concurrent CLI sessions](../../CLAUDE.md): read the file's `## Active` section first; if any `started`-status entry overlaps the files you're about to fix and is <2h old, surface the conflict to the user (test results from a hot codebase may diverge between consecutive runs as concurrent edits land — record the SHA the run was kicked off against in your test report).

**Declared paths for `/cli-quality-check`:** scope is per-fix-up batch, not the test execution itself.
- The Rust/TS files modified by fix-ups (varies per run — typically `src-tauri/src/**/*.rs` and `src/**/*.{ts,tsx}` in the feature area being tested)
- Test result reports (if persisted — wherever the skill writes them)
- Always: `.claude/active-runs.md`

If the run is read-only test execution with no fix-ups, you MAY skip ledger registration. Record the `git rev-parse HEAD` snapshot in the test report so future runs can compare apples-to-apples.

**At session end** (after the final fix-up commit or test report is written): move your entry to the top of `## Recently completed`. Update `Status` to `completed (commit: <last-sha-if-fix-ups>)` or `completed (test-only, no commit, run against <starting-sha>)` or `aborted (<reason>)`. Trim entries older than 14 days while you're there.

Full design rationale: [`docs/concepts/cli-coordination-active-runs.md`](../../../docs/concepts/cli-coordination-active-runs.md).

### Parallel-safety primitives (mandatory)

Per [`CLAUDE.md` → Parallel-safety primitives](../../CLAUDE.md), every CLI session must:

1. **Never `git stash`** other sessions' work — not even with `--keep-index`. If your commit step needs a clean stage, use `git add <path>` per file (NOT `git add -A` / `git add .` / `git add -u`); leave everything else alone.
2. **Use a worktree for fix-up batches.** Pure test execution stays on the main checkout. For fix-up commits (especially across multiple feature areas):
   ```bash
   git worktree add .claude/worktrees/cli-quality-fix-<YYYYMMDD-HHMM> -b worktree-cli-quality-fix-<YYYYMMDD-HHMM>
   cd .claude/worktrees/cli-quality-fix-<YYYYMMDD-HHMM>
   ```
3. **Atomic commits per failing-feature group.** One commit per feature area's fix bundle (e.g. `fix(persona-design): cli-quality-check failures in Sonnet 4.6`). Never bundle fixes from different feature areas into one commit — failures may have been caused by different upstream changes.
4. **Verify the staged index before commit.** After `git add` and before `git commit`, run `git diff --cached --stat`. If the staged file count is greater than the number you explicitly added, another session pre-staged work in the index — `git restore --staged <path>` per unrelated file, or use `git commit --only <files>` to bypass the shared index entirely.
5. **Clean up the worktree after merge.** Once the fix commit(s) are in `git log master`, from the main checkout: `git worktree remove .claude/worktrees/cli-quality-fix-<YYYYMMDD-HHMM>` and `git branch -D worktree-cli-quality-fix-<YYYYMMDD-HHMM>`. Treat as part of the session-end ledger ritual.

---

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
