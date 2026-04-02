/* ==============================================================================
   Verifier
   Runs quality gates after each area execution.
   ============================================================================== */

import { execSync } from 'child_process';
import type { VerificationGate, VerificationReport, VerificationResult } from './types';

// ---------------------------------------------------------------------------
//  Built-in Gates for Personas
// ---------------------------------------------------------------------------

export const PERSONAS_GATES: VerificationGate[] = [
  {
    name: 'typecheck',
    type: 'typecheck',
    required: true,
    command: 'npx tsc --noEmit',
    timeoutMs: 120_000,
  },
  {
    name: 'lint',
    type: 'lint',
    required: true,
    command: 'npm run lint',
    timeoutMs: 120_000,
  },
  {
    name: 'build',
    type: 'build',
    required: false,
    command: 'npx vite build',
    timeoutMs: 180_000,
  },
];

// ---------------------------------------------------------------------------
//  Custom Gates for Scenario Goals
// ---------------------------------------------------------------------------

export function typographyAuditGate(scope: string[]): VerificationGate {
  // Count raw text-size classes in .tsx files (should be 0)
  const scopeArgs = scope.map((s) => `--include="${s}/**/*.tsx"`).join(' ');
  return {
    name: 'typography-audit',
    type: 'custom',
    required: false,
    command: [
      'grep -rn',
      '"\\btext-xs\\b\\|\\btext-sm\\b\\|\\btext-base\\b\\|\\btext-lg\\b\\|\\btext-xl\\b\\|\\btext-2xl\\b\\|\\btext-3xl\\b\\|\\btext-4xl\\b"',
      scope.join(' '),
      '--include="*.tsx"',
      '| grep -v "text-foreground\\|text-muted\\|text-background\\|text-primary\\|text-secondary\\|text-accent\\|text-status\\|text-brand\\|text-card\\|text-destructive\\|text-white\\|text-black\\|text-inherit\\|text-current\\|text-transparent\\|text-center\\|text-left\\|text-right\\|text-ellipsis\\|text-wrap\\|text-nowrap\\|text-balance\\|text-clip\\|text-start\\|text-end"',
      '| wc -l',
    ].join(' '),
  };
}

export function i18nAuditGate(scope: string[]): VerificationGate {
  return {
    name: 'i18n-audit',
    type: 'custom',
    required: false,
    command: [
      'grep -rn',
      '\'placeholder="[A-Z]\\|title="[A-Z]\\|aria-label="[A-Z]\'',
      scope.join(' '),
      '--include="*.tsx"',
      '| grep -v "node_modules\\|\\.test\\."',
      '| wc -l',
    ].join(' '),
  };
}

export function notificationCoverageGate(): VerificationGate {
  return {
    name: 'notification-coverage',
    type: 'custom',
    required: false,
    command:
      'grep -rn "notifyProcessComplete" src/ --include="*.ts" --include="*.tsx" | wc -l',
  };
}

// ---------------------------------------------------------------------------
//  Verification Runner
// ---------------------------------------------------------------------------

export function runGate(
  gate: VerificationGate,
  projectPath: string,
): VerificationResult {
  const startTime = Date.now();
  const timeout = gate.timeoutMs ?? 120_000;

  try {
    const output = execSync(gate.command, {
      cwd: projectPath,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return {
      gate: gate.name,
      passed: true,
      output: output.slice(0, 5000),
      durationMs: Date.now() - startTime,
      errors: undefined,
    };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    const output = (execErr.stdout ?? '') + '\n' + (execErr.stderr ?? '');
    const errors = parseGateErrors(gate.type, output);

    // For custom count gates: "0" means pass
    if (gate.type === 'custom' && output.trim() === '0') {
      return {
        gate: gate.name,
        passed: true,
        output: '0 violations',
        durationMs: Date.now() - startTime,
        errors: undefined,
      };
    }

    return {
      gate: gate.name,
      passed: false,
      output: output.slice(0, 5000),
      durationMs: Date.now() - startTime,
      errors,
    };
  }
}

export function verify(
  gates: VerificationGate[],
  projectPath: string,
  iteration: number,
  areaId: string,
): VerificationReport {
  const results = gates.map((gate) => runGate(gate, projectPath));

  const requiredFailures = gates
    .filter((g) => g.required)
    .reduce((count, gate) => {
      const result = results.find((r) => r.gate === gate.name);
      return count + (result && !result.passed ? 1 : 0);
    }, 0);

  return {
    iteration,
    areaId,
    timestamp: new Date().toISOString(),
    gates: results,
    allPassed: results.every((r) => r.passed),
    requiredFailures,
  };
}

// ---------------------------------------------------------------------------
//  Error Parsing
// ---------------------------------------------------------------------------

function parseGateErrors(type: string, output: string): string[] {
  const errors: string[] = [];
  const lines = output.split('\n');

  switch (type) {
    case 'typecheck': {
      // TS errors: src/file.ts(12,5): error TS2345: ...
      for (const line of lines) {
        if (/error TS\d+/.test(line)) {
          errors.push(line.trim());
        }
      }
      break;
    }
    case 'lint': {
      // ESLint: /path/file.tsx  12:5  error  message  rule-name
      for (const line of lines) {
        if (/\d+:\d+\s+error/.test(line)) {
          errors.push(line.trim());
        }
      }
      break;
    }
    default: {
      // Generic: first 10 non-empty lines
      const meaningful = lines.filter((l) => l.trim()).slice(0, 10);
      errors.push(...meaningful);
    }
  }

  return errors.slice(0, 20); // cap at 20
}
