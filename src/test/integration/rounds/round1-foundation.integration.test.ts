/**
 * Round 1: Foundation -- Auth smoke test and structured JSON output.
 *
 * These tests verify basic CLI connectivity and response formatting
 * for each available provider. No tool use is expected.
 */
import { getAvailableProviders } from '../helpers/providerDetection';
import { runCli } from '../helpers/cliRunner';
import { createWorkspace } from '../helpers/workspaceManager';
import { createTestDb } from '../helpers/testDatabase';
import { validateResult, formatDiagnostic } from '../helpers/resultValidator';
import type { WorkspaceContext } from '../helpers/types';
import type { TestDbContext } from '../helpers/testDatabase';

const providers = getAvailableProviders();
let db: TestDbContext;
let workspace: WorkspaceContext;

beforeAll(() => {
  db = createTestDb();
});

afterAll(() => {
  db.destroy();
});

afterEach(() => {
  workspace?.destroy();
});

for (const provider of providers) {
  describe(`${provider.displayName}`, () => {
    // ---------------------------------------------------------------------
    // Test 1: Auth smoke test
    // ---------------------------------------------------------------------
    it('auth smoke test -- responds with READY and model name', async () => {
      workspace = createWorkspace('empty');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Respond with exactly one line: READY followed by your model name. Do not use any tools. Do not write any files.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 30_000,
      });

      const validation = validateResult(result, {
        expectSuccess: true,
        outputContains: ['ready'],
        maxDurationMs: 30_000,
      });

      db.recordExecution({
        id: `round1-auth-smoke-${provider.name}`,
        round: 'round1',
        testName: 'auth smoke test',
        provider: provider.name,
        model: provider.model,
        status: validation.passed ? 'pass' : 'fail',
        score: validation.score,
        durationMs: result.totalDurationMs,
        costUsd: result.reportedCostUsd ?? 0,
        inputTokens: result.reportedInputTokens ?? 0,
        outputTokens: result.reportedOutputTokens ?? 0,
        toolCallCount: result.toolCallCount,
        toolsUsed: JSON.stringify(result.toolsUsed),
        assistantTextLength: result.assistantText.length,
        errorMessage: result.timedOut ? 'Timed out' : undefined,
        validationDetails: JSON.stringify(validation.details),
      });

      expect(validation.passed, formatDiagnostic(result, validation)).toBe(true);
    }, 60_000);

    // ---------------------------------------------------------------------
    // Test 2: Structured JSON output
    // ---------------------------------------------------------------------
    it('structured JSON output -- returns valid JSON with required fields', async () => {
      workspace = createWorkspace('empty');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Output ONLY a valid JSON object with these exact fields: { "cli_name": your name as a CLI tool, "model": your model identifier, "capabilities": an array of 3 strings describing your capabilities }. Do not use tools. Do not add any explanation before or after the JSON.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 60_000,
      });

      const validation = validateResult(result, {
        expectSuccess: true,
        custom: (res) => {
          const text = res.assistantText.trim();

          // Try to extract JSON from the response -- it may be wrapped in markdown fences
          let jsonStr = text;
          const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenceMatch) {
            jsonStr = fenceMatch[1].trim();
          }

          // Also try to find raw JSON object in the text
          if (!jsonStr.startsWith('{')) {
            const braceMatch = text.match(/\{[\s\S]*\}/);
            if (braceMatch) {
              jsonStr = braceMatch[0];
            }
          }

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            return {
              passed: false,
              detail: `Could not parse JSON from response: "${text.slice(0, 200)}"`,
            };
          }

          const errors: string[] = [];

          if (typeof parsed.cli_name !== 'string' || parsed.cli_name.length === 0) {
            errors.push('missing or invalid cli_name');
          }
          if (typeof parsed.model !== 'string' || parsed.model.length === 0) {
            errors.push('missing or invalid model');
          }
          if (!Array.isArray(parsed.capabilities)) {
            errors.push('capabilities is not an array');
          } else if (parsed.capabilities.length < 3) {
            errors.push(`capabilities has ${parsed.capabilities.length} items, expected >= 3`);
          } else {
            const allStrings = parsed.capabilities.every((c: unknown) => typeof c === 'string');
            if (!allStrings) {
              errors.push('capabilities contains non-string items');
            }
          }

          if (errors.length > 0) {
            return { passed: false, detail: `JSON field issues: ${errors.join('; ')}` };
          }

          return {
            passed: true,
            detail: `Valid JSON with cli_name="${parsed.cli_name}", model="${parsed.model}", ${(parsed.capabilities as string[]).length} capabilities`,
          };
        },
      });

      db.recordExecution({
        id: `round1-structured-json-${provider.name}`,
        round: 'round1',
        testName: 'structured JSON output',
        provider: provider.name,
        model: provider.model,
        status: validation.passed ? 'pass' : 'fail',
        score: validation.score,
        durationMs: result.totalDurationMs,
        costUsd: result.reportedCostUsd ?? 0,
        inputTokens: result.reportedInputTokens ?? 0,
        outputTokens: result.reportedOutputTokens ?? 0,
        toolCallCount: result.toolCallCount,
        toolsUsed: JSON.stringify(result.toolsUsed),
        assistantTextLength: result.assistantText.length,
        errorMessage: result.timedOut ? 'Timed out' : undefined,
        validationDetails: JSON.stringify(validation.details),
      });

      expect(validation.passed, formatDiagnostic(result, validation)).toBe(true);
    }, 120_000);
  });
}
