/**
 * Round 3: Persona Simulation -- Data Analyst and Code Reviewer personas.
 *
 * These tests verify that each CLI provider can adopt a persona role,
 * analyze domain-specific content, and produce structured deliverables.
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
    // Test 1: Data Analyst persona
    // ---------------------------------------------------------------------
    it('data analyst persona -- analyzes sales CSV and writes report', async () => {
      workspace = createWorkspace('data-analysis');

      const result = await runCli({
        provider: provider.name,
        prompt: [
          'You are a Data Analyst persona. Your role is to analyze data files and produce actionable insights.',
          'Read sales_data.csv.',
          'Identify:',
          '(a) which product has highest total revenue,',
          '(b) which region has highest total revenue,',
          '(c) any notable trends.',
          'Write your analysis to analysis_report.md.',
        ].join(' '),
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(
        result,
        {
          expectSuccess: true,
          filesCreated: ['analysis_report.md'],
          // Widget A has highest total (64500), Widget C has highest per-unit.
          // Accept either interpretation as valid analysis.
          outputContainsAny: ['widget c', 'widget a'],
          toolsUsed: ['read', 'write'],
        },
        workspace,
      );

      db.recordExecution({
        id: `round3-data-analyst-${provider.name}`,
        round: 'round3',
        testName: 'data analyst persona',
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
    // Test 2: Code Reviewer persona
    // ---------------------------------------------------------------------
    it('code reviewer persona -- identifies bugs in utils.ts', async () => {
      workspace = createWorkspace('code-review');

      const result = await runCli({
        provider: provider.name,
        prompt:
          'You are a Code Reviewer persona. Review the file src/utils.ts in the current directory. Identify all bugs and code quality issues. For each bug, explain the problem and suggest a fix. The file has at least 4 known issues.',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 120_000,
      });

      const validation = validateResult(result, {
        expectSuccess: true,
        toolsUsed: ['read'],
        custom: (res) => {
          const text = res.assistantText.toLowerCase();

          // The 4 known bugs in src/utils.ts:
          // 1. No input validation (negative price, discount > 1)
          // 2. NaN handling in formatCurrency
          // 3. parseInt without radix in parseUserInput
          // 4. Dead code / unused deprecatedHelper
          //
          // We check for keywords indicating the reviewer found each issue.
          // Require at least 3 of 4 to pass.
          const issueIndicators = [
            // Bug 1: validation issues
            /validat|negative|discount.*(?:greater|>|exceed|range|bound)|price.*(?:check|guard|negat)/,
            // Bug 2: NaN handling
            /\bnan\b|not\s*a\s*number|isnan|number.*check|format.*(?:invalid|handle)/,
            // Bug 3: parseInt radix
            /parseint.*(?:radix|base|10)|radix|second.*(?:param|arg)|parseint\b.*\b10\b/,
            // Bug 4: unused/deprecated/dead code
            /unused|deprecat|dead\s*code|never.*(?:call|use|invok|referenc)|remove|unreachable/,
          ];

          const found = issueIndicators.filter((re) => re.test(text));
          const foundCount = found.length;

          if (foundCount >= 3) {
            return {
              passed: true,
              detail: `Identified ${foundCount}/4 known issues`,
            };
          }

          return {
            passed: false,
            detail: `Only identified ${foundCount}/4 known issues (need >= 3). Text preview: "${text.slice(0, 300)}"`,
          };
        },
      });

      db.recordExecution({
        id: `round3-code-reviewer-${provider.name}`,
        round: 'round3',
        testName: 'code reviewer persona',
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
