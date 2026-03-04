/**
 * Round 6: Head-to-Head — All providers receive identical prompts and are
 * compared on the same tasks.
 *
 * Unlike other rounds which use per-provider describe blocks, this round
 * runs all available providers sequentially on each task, recording results
 * side-by-side for direct comparison.
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

beforeAll(() => {
  db = createTestDb();
});

afterAll(() => {
  db.destroy();
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 1: Identical complex task — data analysis report
// ═══════════════════════════════════════════════════════════════════════════
describe('identical complex task — data analysis report', () => {
  const PROMPT =
    'You are an AI data analyst. Read sales_data.csv and produce a comprehensive analysis report. Your report MUST include: (1) Total revenue by product, (2) Top-performing region by total revenue, (3) Month-over-month trend analysis, (4) At least one actionable recommendation. Write the report to report.md.';

  for (const provider of providers) {
    it(`${provider.displayName} — produces correct analysis report`, async () => {
      const workspace: WorkspaceContext = createWorkspace('data-analysis');

      try {
        const result = await runCli({
          provider: provider.name,
          prompt: PROMPT,
          cwd: workspace.rootDir,
          model: provider.model,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['report.md'],
            toolsUsed: ['read', 'write'],
            fileContentContains: { 'report.md': ['widget'] },
          },
          workspace,
        );

        db.recordExecution({
          id: `round6-data-analysis-${provider.name}`,
          round: 'round6',
          testName: 'identical complex task — data analysis',
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
      } finally {
        workspace.destroy();
      }
    }, 180_000);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2: Efficiency comparison — fibonacci implementation + tests
// ═══════════════════════════════════════════════════════════════════════════
describe('efficiency comparison — fibonacci implementation + tests', () => {
  const PROMPT =
    'Create a TypeScript function called fibonacci that calculates the nth Fibonacci number iteratively (not recursively). Write it to fibonacci.ts. Then verify it works by creating a test file fibonacci.test.ts that tests fib(0)=0, fib(1)=1, fib(10)=55.';

  for (const provider of providers) {
    it(`${provider.displayName} — creates fibonacci with tests`, async () => {
      const workspace: WorkspaceContext = createWorkspace('empty');

      try {
        const result = await runCli({
          provider: provider.name,
          prompt: PROMPT,
          cwd: workspace.rootDir,
          model: provider.model,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['fibonacci.ts', 'fibonacci.test.ts'],
            toolsUsed: ['write'],
            fileContentContains: {
              'fibonacci.ts': ['fibonacci', 'function'],
              'fibonacci.test.ts': ['55'],
            },
          },
          workspace,
        );

        db.recordExecution({
          id: `round6-fibonacci-${provider.name}`,
          round: 'round6',
          testName: 'efficiency comparison — fibonacci',
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
      } finally {
        workspace.destroy();
      }
    }, 180_000);
  }
});
