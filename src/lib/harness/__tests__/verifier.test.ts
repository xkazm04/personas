/**
 * `GateType` has always included `'test'` and `PERSONAS_GATES` never used it,
 * so `requiredFailures` could not count a red suite: an area with clean tsc and
 * eslint reported completed while its unit tests failed. These cases pin the
 * gate that makes the type true, and the two properties around it — a green
 * suite completes, and the optional custom gates stay optional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.fn();
vi.mock('child_process', () => {
  const execSync = (...args: unknown[]) => mockExecSync(...args);
  return { execSync, default: { execSync } };
});

import { PERSONAS_GATES, verify, runGate, typographyAuditGate } from '../verifier';

/** Reject the way `execSync` does: a throw carrying stdout/stderr and a status. */
function failWith(stdout: string) {
  const err = new Error('Command failed') as Error & { stdout: string; stderr: string; status: number };
  err.stdout = stdout;
  err.stderr = '';
  err.status = 1;
  throw err;
}

const VITEST_RED = [
  ' FAIL  src/lib/foo.test.ts > foo > returns the thing',
  '',
  ' Test Files  1 failed (12)',
  '      Tests  1 failed | 240 passed (241)',
].join('\n');

describe('PERSONAS_GATES', () => {
  it('runs the test suite as a REQUIRED gate', () => {
    const test = PERSONAS_GATES.find((g) => g.type === 'test');

    expect(test).toBeDefined();
    expect(test!.required).toBe(true);
    expect(test!.command).toContain('npm run test');
    // Non-interactive: a watch-mode gate would hang the orchestrator to its
    // timeout rather than report.
    expect(test!.command).toContain('--run');
  });

  it('gives the suite more room than typecheck, because it needs it', () => {
    const test = PERSONAS_GATES.find((g) => g.type === 'test')!;
    const typecheck = PERSONAS_GATES.find((g) => g.type === 'typecheck')!;

    expect(test.timeoutMs!).toBeGreaterThanOrEqual(typecheck.timeoutMs!);
  });
});

describe('verify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails the area when the suite is red and everything else is green', () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes('npm run test')) failWith(VITEST_RED);
      return 'ok';
    });

    const report = verify(PERSONAS_GATES, '/repo', 1, 'area-1');

    expect(report.requiredFailures).toBe(1);
    expect(report.allPassed).toBe(false);
    const test = report.gates.find((g) => g.gate === 'test')!;
    expect(test.passed).toBe(false);
    // The report names WHICH case broke, not just that something did.
    expect(test.errors).toContain('FAIL  src/lib/foo.test.ts > foo > returns the thing');
    expect(test.errors).toContain('Tests  1 failed | 240 passed (241)');
  });

  it('completes the area when every required gate is green', () => {
    mockExecSync.mockReturnValue('Test Files  12 passed (12)');

    const report = verify(PERSONAS_GATES, '/repo', 1, 'area-1');

    expect(report.requiredFailures).toBe(0);
    expect(report.allPassed).toBe(true);
    expect(report.gates.map((g) => g.gate)).toContain('test');
  });

  it('leaves the custom grep gates optional — a violation count never fails an area', () => {
    const custom = typographyAuditGate(['src/features/overview']);
    mockExecSync.mockImplementation((command: string) => {
      if (command.startsWith('grep')) failWith('7');
      return 'ok';
    });

    const report = verify([...PERSONAS_GATES, custom], '/repo', 1, 'area-1');

    expect(custom.required).toBe(false);
    expect(report.gates.find((g) => g.gate === 'typography-audit')!.passed).toBe(false);
    // Not required ⇒ does not count against the area.
    expect(report.requiredFailures).toBe(0);
  });

  it('keeps the build gate optional so a slow bundler cannot fail a clean area', () => {
    const build = PERSONAS_GATES.find((g) => g.type === 'build')!;
    expect(build.required).toBe(false);
  });
});

describe('runGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('honours the gate timeout it was given', () => {
    mockExecSync.mockReturnValue('ok');
    const test = PERSONAS_GATES.find((g) => g.type === 'test')!;

    runGate(test, '/repo');

    expect(mockExecSync).toHaveBeenCalledWith(test.command, expect.objectContaining({ cwd: '/repo', timeout: test.timeoutMs }));
  });

  it('still reads a zero-count custom gate as a pass', () => {
    mockExecSync.mockImplementation(() => failWith('0'));

    const result = runGate(typographyAuditGate(['src']), '/repo');

    expect(result.passed).toBe(true);
    expect(result.output).toBe('0 violations');
  });
});
