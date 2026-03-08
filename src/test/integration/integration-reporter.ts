import type { Reporter, TestModule, TestCase } from 'vitest/reporters';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const _dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TestEntry {
  name: string;
  state: 'passed' | 'failed' | 'skipped' | 'pending';
  duration_ms: number;
  provider: string;
  round: string;
}

interface ProviderStats {
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  tests: TestEntry[];
}

interface RoundStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: TestEntry[];
}

interface IntegrationReport {
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration_ms: number;
  };
  providers: Record<string, ProviderStats>;
  rounds: Record<string, RoundStats>;
}

/* ------------------------------------------------------------------ */
/*  Detection helpers                                                  */
/* ------------------------------------------------------------------ */

const PROVIDER_PATTERNS: [RegExp, string][] = [
  [/copilot/i, 'Copilot CLI'],
  [/claude/i, 'Claude Code'],
  [/gemini/i, 'Gemini CLI'],
];

const ROUND_PATTERNS: [RegExp, string][] = [
  [/round1/i, 'round1-foundation'],
  [/round2/i, 'round2-tool-usage'],
  [/round3/i, 'round3-persona-tasks'],
  [/round4/i, 'round4-complex-reasoning'],
  [/round5/i, 'round5-resilience'],
  [/round6/i, 'round6-head-to-head'],
  [/round7/i, 'round7-auto-cred-guided'],
  [/round8/i, 'round8-feature-areas'],
  [/round9/i, 'round9-business-tasks'],
];

function detectProvider(name: string): string {
  for (const [pattern, label] of PROVIDER_PATTERNS) {
    if (pattern.test(name)) return label;
  }
  return 'unknown';
}

function detectRound(name: string, moduleId?: string): string {
  const text = moduleId ? `${name} ${moduleId}` : name;
  for (const [pattern, label] of ROUND_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Console formatting helpers                                         */
/* ------------------------------------------------------------------ */

function boxLine(left: string, fill: string, right: string, width: number): string {
  return left + fill.repeat(width - 2) + right;
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return ' '.repeat(width - text.length) + text;
}

/* ------------------------------------------------------------------ */
/*  Test-case collector (Vitest 4 TestModule API)                      */
/* ------------------------------------------------------------------ */

function collectTestCases(module: TestModule): TestCase[] {
  // Vitest 4: module.children.allTests() returns all nested TestCase instances
  return Array.from(module.children.allTests());
}

/* ------------------------------------------------------------------ */
/*  Reporter                                                           */
/* ------------------------------------------------------------------ */

class IntegrationReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const entries: TestEntry[] = [];

    try {
      for (const mod of testModules) {
        const moduleId = mod.moduleId ?? '';
        if (!moduleId.includes('integration') || !moduleId.includes('round')) continue;

        const testCases = collectTestCases(mod);

        for (const tc of testCases) {
          const fullName = tc.fullName;
          const result = tc.result();
          const state = result.state === 'passed' || result.state === 'failed' || result.state === 'skipped'
            ? result.state
            : 'pending';
          const duration = tc.diagnostic()?.duration ?? 0;

          entries.push({
            name: fullName,
            state,
            duration_ms: Math.round(duration),
            provider: detectProvider(fullName),
            round: detectRound(fullName, moduleId),
          });
        }
      }
    } catch (err) {
      console.error('[IntegrationReporter] Error collecting test cases:', err);
    }

    // Build report
    const report = this.buildReport(entries);

    // Write JSON
    const reportsDir = join(_dirname, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, 'integration-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    // Print console summary
    this.printSummary(report);

    console.log(`\n  Report written to: ${reportPath}\n`);
  }

  private buildReport(entries: TestEntry[]): IntegrationReport {
    const summary = {
      total: entries.length,
      passed: entries.filter((e) => e.state === 'passed').length,
      failed: entries.filter((e) => e.state === 'failed').length,
      skipped: entries.filter((e) => e.state === 'skipped' || e.state === 'pending').length,
      duration_ms: entries.reduce((sum, e) => sum + e.duration_ms, 0),
    };

    // Group by provider
    const providers: Record<string, ProviderStats> = {};
    for (const entry of entries) {
      if (!providers[entry.provider]) {
        providers[entry.provider] = { passed: 0, failed: 0, skipped: 0, duration_ms: 0, tests: [] };
      }
      const p = providers[entry.provider];
      if (entry.state === 'passed') p.passed++;
      else if (entry.state === 'failed') p.failed++;
      else p.skipped++;
      p.duration_ms += entry.duration_ms;
      p.tests.push(entry);
    }

    // Group by round
    const rounds: Record<string, RoundStats> = {};
    for (const entry of entries) {
      if (!rounds[entry.round]) {
        rounds[entry.round] = { total: 0, passed: 0, failed: 0, skipped: 0, tests: [] };
      }
      const r = rounds[entry.round];
      r.total++;
      if (entry.state === 'passed') r.passed++;
      else if (entry.state === 'failed') r.failed++;
      else r.skipped++;
      r.tests.push(entry);
    }

    return {
      generatedAt: new Date().toISOString(),
      summary,
      providers,
      rounds,
    };
  }

  private printSummary(report: IntegrationReport): void {
    const W = 64;
    const inner = W - 2;

    const lines: string[] = [];

    lines.push('');
    lines.push(boxLine('\u250c', '\u2500', '\u2510', W));
    lines.push('\u2502' + padRight('  INTEGRATION TEST REPORT', inner) + '\u2502');
    lines.push(boxLine('\u251c', '\u2500', '\u2524', W));

    // Total summary
    const { total, passed, failed, skipped, duration_ms } = report.summary;
    const dur = (duration_ms / 1000).toFixed(1);
    lines.push('\u2502' + padRight(`  Total: ${total}  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`, inner) + '\u2502');
    lines.push('\u2502' + padRight(`  Duration: ${dur}s`, inner) + '\u2502');

    // Per-provider breakdown
    lines.push(boxLine('\u251c', '\u2500', '\u2524', W));
    lines.push('\u2502' + padRight('  PROVIDERS', inner) + '\u2502');
    lines.push(boxLine('\u251c', '\u2500', '\u2524', W));

    const providerNames = Object.keys(report.providers).sort();
    for (const name of providerNames) {
      const p = report.providers[name];
      const pDur = (p.duration_ms / 1000).toFixed(1);
      const pTotal = p.passed + p.failed + p.skipped;
      const pct = pTotal > 0 ? ((p.passed / pTotal) * 100).toFixed(0) : '0';
      lines.push(
        '\u2502' +
          padRight(`  ${name}`, 22) +
          padLeft(`${p.passed}/${pTotal} (${pct}%)`, 14) +
          padLeft(`${pDur}s`, 10) +
          ' '.repeat(inner - 22 - 14 - 10) +
          '\u2502',
      );
    }

    // Per-round breakdown
    lines.push(boxLine('\u251c', '\u2500', '\u2524', W));
    lines.push('\u2502' + padRight('  ROUNDS', inner) + '\u2502');
    lines.push(boxLine('\u251c', '\u2500', '\u2524', W));

    const roundNames = Object.keys(report.rounds).sort();
    for (const name of roundNames) {
      const r = report.rounds[name];
      const pct = r.total > 0 ? ((r.passed / r.total) * 100).toFixed(0) : '0';
      lines.push(
        '\u2502' +
          padRight(`  ${name}`, 30) +
          padLeft(`${r.passed}/${r.total} (${pct}%)`, 14) +
          ' '.repeat(inner - 30 - 14) +
          '\u2502',
      );
    }

    // Head-to-head comparison
    if (providerNames.length > 1) {
      lines.push(boxLine('\u251c', '\u2500', '\u2524', W));
      lines.push('\u2502' + padRight('  HEAD-TO-HEAD COMPARISON', inner) + '\u2502');
      lines.push(boxLine('\u251c', '\u2500', '\u2524', W));

      // Header row
      const colW = Math.floor((inner - 24) / providerNames.length);
      let header = '\u2502' + padRight('  Round', 24);
      for (const pName of providerNames) {
        const short = pName.replace(/ (Code|CLI)/i, '');
        header += padLeft(short, colW);
      }
      header += ' '.repeat(inner - 24 - colW * providerNames.length) + '\u2502';
      lines.push(header);
      lines.push(boxLine('\u251c', '\u2500', '\u2524', W));

      for (const roundName of roundNames) {
        const r = report.rounds[roundName];
        let row = '\u2502' + padRight(`  ${roundName}`, 24);

        for (const pName of providerNames) {
          const providerTests = r.tests.filter((t) => t.provider === pName);
          const pPassed = providerTests.filter((t) => t.state === 'passed').length;
          const pTotal = providerTests.length;
          if (pTotal > 0) {
            row += padLeft(`${pPassed}/${pTotal}`, colW);
          } else {
            row += padLeft('-', colW);
          }
        }
        row += ' '.repeat(inner - 24 - colW * providerNames.length) + '\u2502';
        lines.push(row);
      }
    }

    lines.push(boxLine('\u2514', '\u2500', '\u2518', W));
    lines.push('');

    console.log(lines.join('\n'));
  }
}

export default IntegrationReporter;
