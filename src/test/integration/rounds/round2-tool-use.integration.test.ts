/**
 * Round 2: Tool Use -- File read, file write, bash execution, multi-tool chain.
 *
 * These tests verify that each CLI provider can correctly invoke tools
 * (read files, write files, run bash commands) and chain them together.
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
    // Test 1: File read + total calculation
    // ---------------------------------------------------------------------
    it('file read + total -- reads CSV and calculates correct sum', async () => {
      workspace = createWorkspace('data-analysis');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Read the file sales_data.csv in the current directory. Calculate the total revenue across all rows. Report ONLY the total as a number. The total should be 122400.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(result, {
        expectSuccess: true,
        outputContains: ['122400'],
        toolsUsed: ['read'],
      });

      db.recordExecution({
        id: `round2-file-read-total-${provider.name}`,
        round: 'round2',
        testName: 'file read + total',
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
    // Test 2: File write
    // ---------------------------------------------------------------------
    it('file write -- creates output.txt with 5 TypeScript bullet points', async () => {
      workspace = createWorkspace('empty');

      const result = await runCli({
        provider: provider.name,
        prompt:
          "Create a file called output.txt in the current directory. Write exactly 5 bullet points about TypeScript, each on its own line starting with '- '. Include the word 'TypeScript' in at least 2 bullets.",
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(
        result,
        {
          expectSuccess: true,
          filesCreated: ['output.txt'],
          fileContentContains: { 'output.txt': ['typescript'] },
          toolsUsed: ['write'],
        },
        workspace,
      );

      db.recordExecution({
        id: `round2-file-write-${provider.name}`,
        round: 'round2',
        testName: 'file write',
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
    // Test 3: Bash execution
    // ---------------------------------------------------------------------
    it('bash execution -- runs node command and reports output', async () => {
      workspace = createWorkspace('empty');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'Use the Bash tool to execute this command: node -e "console.log(7*6)". Then tell me what the output was.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(result, {
        expectSuccess: true,
        outputContains: ['42'],
        toolsUsed: ['bash'],
      });

      db.recordExecution({
        id: `round2-bash-exec-${provider.name}`,
        round: 'round2',
        testName: 'bash execution',
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
    // Test 4: Multi-tool chain
    // ---------------------------------------------------------------------
    it('multi-tool chain -- reads CSV, calculates per-product totals, writes summary', async () => {
      workspace = createWorkspace('data-analysis');

      const result = await runCli({
        provider: provider.name,
        prompt:
          '1. Read sales_data.csv. 2. Calculate total revenue per product. 3. Write a file called summary.txt containing the product name and total for each product, one per line.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(
        result,
        {
          expectSuccess: true,
          filesCreated: ['summary.txt'],
          toolsUsed: ['read'],
          minToolCalls: 2,
          fileContentContains: { 'summary.txt': ['widget a', 'widget b'] },
        },
        workspace,
      );

      db.recordExecution({
        id: `round2-multi-tool-chain-${provider.name}`,
        round: 'round2',
        testName: 'multi-tool chain',
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
