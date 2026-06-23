// Tier-1/Tier-3 upgrade actions for the code-requiring passport rows — the part
// that can't be fixed by flipping config: it needs the repo changed. Each action
// is either a `scan` (run an existing dev-tools scan) or a `task` (deploy Claude
// Code with a precise golden-standard prompt → a dev task that, when run, opens a
// PR). The PROMPTS are the IP: they encode what "golden" means for each gap and
// are written to be read-the-codebase-first, stack-aware, and non-destructive.
import type { DevProject } from '@/lib/bindings/DevProject';
import type { AppPassport } from '../passportModel';

export interface DeployAction {
  id: string;
  /** The passport row this action improves. */
  row: 'context' | 'instructions' | 'tests' | 'observability' | 'evals' | 'security' | 'migrations' | 'hosting';
  label: string;
  hint: string;
  /** `scan` runs an existing dev-tools scan; `task` deploys Claude Code. */
  kind: 'scan' | 'task';
  /** Offer only when the gap actually exists. */
  applicable: (p: AppPassport) => boolean;
  /** For `task` actions: the dev-task title + the Claude prompt. */
  taskTitle?: (project: DevProject) => string;
  prompt?: (project: DevProject, passport: AppPassport) => string;
}

/** Human-readable stack line for prompt grounding. */
export function stackLine(p: AppPassport): string {
  const langs = p.stack.languages.map((l) => l.name).join(', ');
  const fw = p.stack.frameworks.join(', ');
  return [langs && `Languages: ${langs}`, fw && `Frameworks: ${fw}`].filter(Boolean).join('. ') || 'Stack: unknown — detect it from the repo.';
}

export const DEPLOY_ACTIONS: DeployAction[] = [
  {
    id: 'context-scan',
    row: 'context',
    label: 'Run context scan',
    hint: 'Map the repo into the context graph so agents understand it',
    kind: 'scan',
    applicable: (p) => p.automationReadiness.artifacts.contextGraph !== 'full',
  },
  {
    id: 'claude-md',
    row: 'instructions',
    label: 'Generate CLAUDE.md',
    hint: 'Deploy Claude Code to author agent guidance for this repo',
    kind: 'task',
    applicable: (p) => p.automationReadiness.artifacts.agentInstructions.length === 0,
    taskTitle: () => 'Add CLAUDE.md for coding agents',
    prompt: (_project, p) =>
      [
        'Create a CLAUDE.md at the repo root so coding agents can work effectively in this project.',
        '',
        'Read the codebase first — do NOT guess. Document, accurately for THIS repo:',
        '- one-line purpose and the high-level architecture',
        '- the directory structure and where key features live',
        '- the canonical commands: install, build, test, lint, run/dev',
        '- the tech stack and any non-obvious conventions or gotchas',
        '',
        stackLine(p),
        'Keep it concise (one screen), factual, and immediately useful. Do not invent commands that do not exist.',
      ].join('\n'),
  },
  {
    id: 'tests',
    row: 'tests',
    label: 'Add a test suite',
    hint: 'Deploy Claude Code to set up tests + cover the critical path',
    kind: 'task',
    applicable: (p) => p.productionReadiness.tests.level === 'none',
    taskTitle: () => 'Set up automated tests + smoke coverage',
    prompt: (_project, p) =>
      [
        'Set up automated testing for this project and add a first, real test suite.',
        '',
        stackLine(p),
        'Use the idiomatic framework for this stack (vitest/jest for JS-TS, cargo test for Rust, pytest for Python, …).',
        'Wire a `test` script/command if one is missing so the suite runs with a single command.',
        'Cover the critical path: the main happy path plus at least one failure/edge case. Keep the suite small but genuine —',
        'do NOT mock away the behaviour under test. Make sure the suite passes before finishing.',
      ].join('\n'),
  },
  {
    id: 'error-tracking',
    row: 'observability',
    label: 'Wire error tracking',
    hint: 'Deploy Claude Code to add an error-tracking SDK',
    kind: 'task',
    applicable: (p) => p.productionReadiness.observability.level === 'none',
    taskTitle: () => 'Wire error tracking (Sentry SDK)',
    prompt: (_project, p) =>
      [
        'Add error tracking to this project.',
        '',
        stackLine(p),
        'Add the Sentry SDK (or the idiomatic error-tracking tool for this stack) as a dependency.',
        'Initialise it at the application entry point and capture unhandled errors / rejections.',
        'Read the DSN from an environment variable — never hardcode secrets.',
        'Add a short setup note (env var name + where it initialises) to the README or CLAUDE.md.',
      ].join('\n'),
  },
  {
    id: 'evals',
    row: 'evals',
    label: 'Add an eval harness',
    hint: 'Deploy Claude Code to add runnable, scored evals for the core behaviour',
    kind: 'task',
    applicable: (p) => p.automationReadiness.artifacts.evals === 'none',
    taskTitle: () => 'Add an evaluation harness',
    prompt: (_project, p) =>
      [
        'Set up an evaluation harness so this project’s core behaviour can be measured and regression-checked.',
        '',
        stackLine(p),
        'Read the codebase first to identify the most important behaviour(s) to evaluate — the product’s core promise, not trivia.',
        'Create a small set of REAL eval cases (inputs + expected or scored outputs), a runner that executes them, and a single command that runs all evals and prints a pass/score summary.',
        'Prefer the idiomatic eval/test tooling for this stack; keep it deterministic and CI-runnable. Do NOT fabricate cases — ground them in real usage. Make sure the harness runs green before finishing.',
      ].join('\n'),
  },
  {
    id: 'security',
    row: 'security',
    label: 'Harden security',
    hint: 'Deploy Claude Code to add dependency + code scanning, gated in CI',
    kind: 'task',
    applicable: (p) => p.productionReadiness.security.level === 'none' || p.productionReadiness.security.level === 'policy',
    taskTitle: () => 'Add security scanning (deps + code)',
    prompt: (_project, p) =>
      [
        'Add automated security scanning to this project.',
        '',
        stackLine(p),
        'Add dependency vulnerability scanning (Dependabot / `npm audit` / `cargo audit` — whatever is idiomatic) AND static code scanning (CodeQL or the stack’s security lint rules).',
        'Wire both into CI so they run on every PR. Add or update a SECURITY note documenting how scans run and how to report issues.',
        'Never commit secrets — read any tokens from the environment. Keep the change minimal and green.',
      ].join('\n'),
  },
  {
    id: 'migrations',
    row: 'migrations',
    label: 'Add schema migrations',
    hint: 'Deploy Claude Code to add a versioned migration framework',
    kind: 'task',
    applicable: (p) => p.productionReadiness.delivery.migrations === 'none',
    taskTitle: () => 'Add a database migration framework',
    prompt: (_project, p) =>
      [
        'Introduce versioned database migrations so schema changes are ordered and repeatable.',
        '',
        stackLine(p),
        'Read the codebase to find the current schema / DB access. Add the idiomatic migration tool for the stack (sqlx/refinery for Rust, drizzle/prisma/knex for JS-TS, alembic for Python, …).',
        'Capture the EXISTING schema as the initial migration (do not drop data), wire an up/migrate command, and document how to create + run migrations.',
        'Keep migrations reversible where the tool supports it. Verify they apply cleanly on a fresh database before finishing.',
      ].join('\n'),
  },
  {
    id: 'hosting',
    row: 'hosting',
    label: 'Add deployment config',
    hint: 'Deploy Claude Code to add reproducible hosting / deploy configuration',
    kind: 'task',
    applicable: (p) => !p.stack.hosting,
    taskTitle: () => 'Add hosting / deployment config',
    prompt: (_project, p) =>
      [
        'Add deployment configuration so this project can be hosted reproducibly.',
        '',
        stackLine(p),
        'Read the codebase to determine the right target (static site, Node service, containerised app, desktop bundle, …).',
        'Add the idiomatic config: a Dockerfile and/or a platform config (Vercel / Netlify / Fly / Railway / Render) appropriate to the stack, plus a one-command build and a short DEPLOY note covering env vars and the deploy step.',
        'Do not hardcode secrets. Keep it minimal and buildable.',
      ].join('\n'),
  },
];

export function applicableDeployActions(row: string, passport: AppPassport): DeployAction[] {
  return DEPLOY_ACTIONS.filter((a) => a.row === row && a.applicable(passport));
}
