/**
 * Custom Vitest 4 reporter that generates a JSON comparison report
 * for CLI E2E tests, grouped by provider and test file.
 *
 * Output: src/test/e2e/cli-e2e-report.json
 *
 * Report structure:
 * {
 *   generatedAt: ISO timestamp,
 *   summary: { total, passed, failed, skipped, duration_ms },
 *   providers: {
 *     "Claude Code (claude-sonnet-4-6)": { passed, failed, tests: [...] },
 *     "Gemini CLI (gemini-3-flash-preview)": { ... },
 *     "Copilot CLI (gpt-5.1-codex-mini)": { ... },
 *     "Cross-provider": { ... }
 *   },
 *   files: {
 *     "cli-stream-core.e2e.test.ts": { total, passed, failed, duration_ms, tests: [...] },
 *     ...
 *   }
 * }
 */
import type { Reporter, TestModule, TestCase } from 'vitest/reporters';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const _dirname = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));

interface TestEntry {
  name: string;
  file: string;
  state: 'pass' | 'fail' | 'skip';
  duration_ms: number;
  error?: string;
  provider?: string;
}

interface ProviderSummary {
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  tests: TestEntry[];
}

interface FileSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  tests: TestEntry[];
}

interface CliE2eReport {
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration_ms: number;
  };
  providers: Record<string, ProviderSummary>;
  files: Record<string, FileSummary>;
}

/** Detect provider from test name or describe path */
function detectProvider(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('claude')) return 'Claude Code (claude-sonnet-4-6)';
  if (lower.includes('gemini')) return 'Gemini CLI (gemini-3-flash-preview)';
  if (lower.includes('copilot')) return 'Copilot CLI (gpt-5.1-codex-mini)';
  if (lower.includes('cross-scenario') || lower.includes('concurrent') || lower.includes('cross-provider'))
    return 'Cross-provider';
  return 'General';
}

function collectFromTestCase(tc: TestCase, fileName: string): TestEntry {
  const result = tc.result();
  const state = result.state === 'passed'
    ? 'pass' as const
    : result.state === 'failed'
      ? 'fail' as const
      : 'skip' as const;
  const duration = tc.diagnostic()?.duration ?? 0;
  const error = result.state === 'failed' ? result.errors?.[0]?.message : undefined;

  return {
    name: tc.fullName,
    file: fileName,
    state,
    duration_ms: Math.round(duration),
    ...(error && { error: String(error).slice(0, 500) }),
    provider: detectProvider(tc.fullName),
  };
}

export default class CliE2eReporter implements Reporter {
  private allTests: TestEntry[] = [];
  private startTime = 0;

  onInit() {
    this.startTime = Date.now();
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    try {
      for (const mod of testModules) {
        const moduleId = mod.moduleId ?? '';
        if (!moduleId.includes('e2e') || !moduleId.includes('cli-')) continue;

        const fileName = basename(moduleId);
        for (const tc of mod.children.allTests()) {
          this.allTests.push(collectFromTestCase(tc, fileName));
        }
      }

      if (this.allTests.length === 0) return;

      const totalDuration = Date.now() - this.startTime;

      // Build provider summaries
      const providers: Record<string, ProviderSummary> = {};
      for (const test of this.allTests) {
        const prov = test.provider ?? 'General';
        if (!providers[prov]) {
          providers[prov] = { passed: 0, failed: 0, skipped: 0, duration_ms: 0, tests: [] };
        }
        providers[prov].tests.push(test);
        providers[prov].duration_ms += test.duration_ms;
        if (test.state === 'pass') providers[prov].passed++;
        else if (test.state === 'fail') providers[prov].failed++;
        else providers[prov].skipped++;
      }

      // Build file summaries
      const fileMap: Record<string, FileSummary> = {};
      for (const test of this.allTests) {
        if (!fileMap[test.file]) {
          fileMap[test.file] = { total: 0, passed: 0, failed: 0, skipped: 0, duration_ms: 0, tests: [] };
        }
        fileMap[test.file].total++;
        fileMap[test.file].duration_ms += test.duration_ms;
        fileMap[test.file].tests.push(test);
        if (test.state === 'pass') fileMap[test.file].passed++;
        else if (test.state === 'fail') fileMap[test.file].failed++;
        else fileMap[test.file].skipped++;
      }

      const report: CliE2eReport = {
        generatedAt: new Date().toISOString(),
        summary: {
          total: this.allTests.length,
          passed: this.allTests.filter((t) => t.state === 'pass').length,
          failed: this.allTests.filter((t) => t.state === 'fail').length,
          skipped: this.allTests.filter((t) => t.state === 'skip').length,
          duration_ms: totalDuration,
        },
        providers,
        files: fileMap,
      };

      const outDir = resolve(_dirname);
      mkdirSync(outDir, { recursive: true });
      const outPath = resolve(outDir, 'cli-e2e-report.json');
      writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

      // Print summary to console
      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║           CLI E2E Report: cli-e2e-report.json           ║');
      console.log('╠══════════════════════════════════════════════════════════╣');
      console.log(`║  Total: ${report.summary.total}  ✓ ${report.summary.passed}  ✗ ${report.summary.failed}  ⊘ ${report.summary.skipped}  ⏱ ${report.summary.duration_ms}ms`);
      console.log('╠══════════════════════════════════════════════════════════╣');
      for (const [name, prov] of Object.entries(providers)) {
        const icon = prov.failed > 0 ? '✗' : '✓';
        console.log(`║  ${icon} ${name}: ${prov.passed}/${prov.passed + prov.failed + prov.skipped} passed (${prov.duration_ms}ms)`);
      }
      console.log('╠══════════════════════════════════════════════════════════╣');
      for (const [name, fileSummary] of Object.entries(fileMap)) {
        const icon = fileSummary.failed > 0 ? '✗' : '✓';
        console.log(`║  ${icon} ${name}: ${fileSummary.passed}/${fileSummary.total} (${fileSummary.duration_ms}ms)`);
      }
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`\n  Report saved to: ${outPath}\n`);
    } catch (err) {
      console.error('[CliE2eReporter] Failed to generate report:', err);
    }
  }
}
