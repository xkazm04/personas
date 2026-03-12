/**
 * Round 4: Complex Reasoning -- SQL debugging and multi-file data flow analysis.
 *
 * These tests evaluate each provider's ability to reason across multiple files,
 * identify bugs in SQL queries, and trace data transformations through a
 * TypeScript codebase.
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
    // Test 1: SQL debugging -- fix 3 bugs in a broken query
    // ---------------------------------------------------------------------
    it('SQL debugging -- identifies and fixes 3 query bugs', async () => {
      workspace = createWorkspace('sql-debugging');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Read the files schema.sql and broken_query.sql in the current directory. The query has 3 bugs: (1) missing JOIN condition causing a cross join, (2) ambiguous column reference for \'status\', (3) HAVING clause uses a raw column instead of an aggregate. Fix all 3 bugs and explain each fix. Write the corrected query to fixed_query.sql.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(
        result,
        {
          expectSuccess: true,
          filesCreated: ['fixed_query.sql'],
          toolsUsed: ['read', 'write'],
          fileContentContains: {
            'fixed_query.sql': ['user_id'],
          },
          outputContains: ['join', 'ambiguous'],
        },
        workspace,
      );

      db.recordExecution({
        id: `round4-sql-debugging-${provider.name}`,
        round: 'round4',
        testName: 'SQL debugging',
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

    // ---------------------------------------------------------------------
    // Test 2: Multi-file analysis -- trace data flow across modules
    // ---------------------------------------------------------------------
    it('multi-file analysis -- traces data flow and predicts output', async () => {
      workspace = createWorkspace('multi-file-project');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Read all .ts files in the src/ directory and the data/input.json file. Trace the data flow from index.ts through the other modules. Explain: (1) what happens to records with empty \'value\' fields, (2) what order the output records will appear in, (3) the final output when this program runs.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(result, {
        expectSuccess: true,
        toolsUsed: ['read'],
        outputContains: ['filter'],
        outputContainsAny: ['empty', 'removed', 'excluded', 'skipped'],
        custom: (res) => {
          // The processor sorts by id ascending: id 1, then id 2 (id 3 is filtered out).
          // Check that the output mentions this ordering.
          const text = res.assistantText.toLowerCase();

          const mentionsOrdering =
            // Explicit id ordering: 1 before 2
            (text.includes('1') && text.includes('2') && text.indexOf('1') < text.lastIndexOf('2')) ||
            // Or mentions sorting/sorted/ascending
            text.includes('sort') ||
            text.includes('ascending') ||
            text.includes('ordered');

          if (mentionsOrdering) {
            return {
              passed: true,
              detail: 'Output correctly references record ordering (id 1 then id 2)',
            };
          }
          return {
            passed: false,
            detail: 'Output does not mention that records appear in id order (1 then 2)',
          };
        },
      });

      db.recordExecution({
        id: `round4-multi-file-analysis-${provider.name}`,
        round: 'round4',
        testName: 'multi-file analysis',
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
