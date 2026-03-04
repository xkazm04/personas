/**
 * Round 5: Resilience — Large input processing and graceful failure handling.
 *
 * These tests evaluate how each provider handles edge cases: processing a
 * large dataset (1000 records) and recovering gracefully from a missing file.
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
    // ─────────────────────────────────────────────────────────────────────
    // Test 1: Large input processing — count active records in 1000 lines
    // ─────────────────────────────────────────────────────────────────────
    it('large input processing — counts 334 active records from 1000-line file', async () => {
      workspace = createWorkspace('large-input');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Read the file large_data.txt in the current directory. It contains 1000 records. Count how many records have status=active. The answer should be 334. Report ONLY the count.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(
        result,
        {
          expectSuccess: true,
          outputContains: ['334'],
          minToolCalls: 1,
          maxDurationMs: 120_000,
        },
        workspace,
      );

      db.recordExecution({
        id: `round5-large-input-${provider.name}`,
        round: 'round5',
        testName: 'large input processing',
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
    }, 180_000);

    // ─────────────────────────────────────────────────────────────────────
    // Test 2: Graceful failure handling — read a nonexistent file
    // ─────────────────────────────────────────────────────────────────────
    it('graceful failure handling — explains missing file without crashing', async () => {
      workspace = createWorkspace('empty');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Try to read a file called nonexistent_file.txt in the current directory. It does not exist. Explain what happened and suggest what to do next. Do NOT create the file.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(
        result,
        {
          expectSuccess: true,
          outputContainsAny: [
            'not found',
            'does not exist',
            'no such file',
            'error',
            'cannot',
          ],
        },
        workspace,
      );

      db.recordExecution({
        id: `round5-graceful-failure-${provider.name}`,
        round: 'round5',
        testName: 'graceful failure handling',
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
    }, 180_000);
  });
}
