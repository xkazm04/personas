// R7 — the PORTFOLIO layer above the cockpit. Three full AppPassport literals,
// one per mock project (slug === MockProject.id so wall→cockpit navigation is a
// straight map). The two new wall variants and the embedded production Passport
// Wall all read THE SAME passports through THE SAME row spec (passportRows
// SECTIONS) — identical functionality, different paint. Nothing here touches
// the store or IPC.
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';

import { MOCK_PROJECTS, gridFor, gridSummary, type MockProject } from './cockpitMock';

/** FULL — the flagship: everything wired, two honest blockers. */
const nimbusPassport: AppPassport = {
  passport: 'app-passport',
  passportVersion: '1',
  identity: {
    name: 'Nimbus CRM',
    slug: 'mock-nimbus',
    purpose: 'Customer relationship suite — the flagship, fully instrumented.',
    archetype: 'team',
    lifecycle: 'ga',
    criticality: 'business',
  },
  stack: {
    languages: [{ name: 'TypeScript', primary: true }, { name: 'Rust' }],
    runtime: 'Node 22',
    frameworks: ['React', 'Tauri', 'Vite'],
    packageManager: 'npm',
    persistence: [{ kind: 'relational', engine: 'PostgreSQL', orm: 'Prisma', migrations: 'versioned' }],
    monitoring: { errorTracking: 'Sentry', logs: 'pino', metrics: 'Prometheus', tracing: null },
    llmTracking: 'LightTrack',
    hosting: 'Vercel',
    auth: 'Auth.js',
    integrations: [
      { name: 'Stripe', kind: 'payments' },
      { name: 'Resend', kind: 'email' },
      { name: 'Slack', kind: 'comms' },
      { name: 'Claude', kind: 'llm' },
    ],
    secretsFrom: 'Vault',
  },
  automationReadiness: {
    level: 'L4',
    score: 78,
    artifacts: {
      agentInstructions: ['CLAUDE.md', '.ai/manifest.yaml'],
      contextGraph: 'full',
      memory: true,
      manifest: true,
      evals: 'partial',
      skills: true,
    },
    selfVerify: { build: true, test: true, lint: true, typecheck: true },
    aiInWorkflow: true,
    blockers: ['Evals cover 2 of 7 critical flows'],
  },
  productionReadiness: {
    band: 'production',
    score: 82,
    ci: { level: 'gated', provider: 'GitHub Actions', gates: ['lint', 'test', 'types'] },
    tests: { level: 'substantial', coveragePct: 61, frameworks: ['Vitest', 'Playwright'], criticalPathCovered: true },
    security: { level: 'scanning', tools: ['CodeQL', 'npm audit'] },
    observability: { level: 'metrics' },
    delivery: { migrations: 'versioned', iac: true, rollback: true },
    blockers: ['CI gate lacks a progressive rollout stage'],
  },
};

/** HALF — instrumented halfway; the gaps must read as invitations, not failure. */
const atlasPassport: AppPassport = {
  passport: 'app-passport',
  passportVersion: '1',
  identity: {
    name: 'Atlas Docs',
    slug: 'mock-atlas',
    purpose: 'Documentation platform — instrumented halfway; the CTAs must earn the rest.',
    archetype: 'team',
    lifecycle: 'beta',
    criticality: 'internal',
  },
  stack: {
    languages: [{ name: 'TypeScript', primary: true }],
    runtime: 'Node 20',
    frameworks: ['Next.js'],
    packageManager: 'pnpm',
    persistence: [{ kind: 'document', engine: 'MongoDB', migrations: 'scripted' }],
    monitoring: { errorTracking: 'Sentry', logs: 'console', metrics: null, tracing: null },
    llmTracking: null,
    hosting: 'Fly.io',
    auth: null,
    integrations: [
      { name: 'Algolia', kind: 'search' },
      { name: 'Claude', kind: 'llm' },
    ],
  },
  automationReadiness: {
    level: 'L3',
    score: 58,
    artifacts: {
      agentInstructions: ['CLAUDE.md'],
      contextGraph: 'partial',
      memory: false,
      manifest: false,
      evals: 'none',
      skills: false,
    },
    selfVerify: { build: true, test: true, lint: true, typecheck: false },
    aiInWorkflow: true,
    blockers: ['Context graph covers half the app', 'No evals at all'],
  },
  productionReadiness: {
    band: 'beta',
    score: 49,
    ci: { level: 'checks', provider: 'GitHub Actions' },
    tests: { level: 'partial', coveragePct: 34, frameworks: ['Vitest'] },
    security: { level: 'policy' },
    observability: { level: 'errors' },
    delivery: { migrations: 'scripted', iac: false, rollback: false },
    blockers: ['LLM cost invisible — no tracer wired', 'Auth story undecided', 'Coverage 34% and flat'],
  },
};

/** BARE — registered five minutes ago; the wall must sell the establishment. */
const cometPassport: AppPassport = {
  passport: 'app-passport',
  passportVersion: '1',
  identity: {
    name: 'Comet Landing',
    slug: 'mock-comet',
    purpose: 'Fresh marketing site — registered five minutes ago; nothing wired yet.',
    archetype: 'solo',
    lifecycle: 'prototype',
    criticality: 'experimental',
  },
  stack: {
    languages: [{ name: 'TypeScript', primary: true }],
    frameworks: ['Astro'],
    persistence: [],
    monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null },
    llmTracking: null,
    hosting: null,
    auth: null,
    integrations: [],
  },
  automationReadiness: {
    level: 'L1',
    score: 12,
    artifacts: {
      agentInstructions: [],
      contextGraph: 'none',
      memory: false,
      manifest: false,
      evals: 'none',
      skills: false,
    },
    selfVerify: { build: false, test: false, lint: false, typecheck: false },
    aiInWorkflow: false,
    blockers: ['No agent instructions', 'Nothing self-verifies'],
  },
  productionReadiness: {
    band: 'prototype',
    score: 8,
    ci: { level: 'none' },
    tests: { level: 'none' },
    security: { level: 'none' },
    observability: { level: 'none' },
    delivery: { migrations: 'none', iac: false, rollback: false },
    blockers: ['No CI', 'No tests', 'Nothing wired — register connections first'],
  },
};

// -- the wall entries -----------------------------------------------------------

export interface WallEntry {
  project: MockProject;
  passport: AppPassport;
}

const PASSPORT_BY_ID: Record<string, AppPassport> = {
  'mock-nimbus': nimbusPassport,
  'mock-atlas': atlasPassport,
  'mock-comet': cometPassport,
};

export const WALL: WallEntry[] = MOCK_PROJECTS.map((project) => ({
  project,
  passport: PASSPORT_BY_ID[project.id]!,
}));

export const MOCK_PASSPORTS: AppPassport[] = WALL.map((e) => e.passport);

// -- shared sort (mirrors the production wall so functionality is preserved) ----

export type WallSort = 'name' | 'automation' | 'production' | 'gap';

export function sortWall(entries: WallEntry[], sort: WallSort): WallEntry[] {
  const base = [...entries];
  switch (sort) {
    case 'automation':
      return base.sort((a, b) => a.passport.automationReadiness.score - b.passport.automationReadiness.score);
    case 'production':
      return base.sort((a, b) => a.passport.productionReadiness.score - b.passport.productionReadiness.score);
    case 'gap':
      return base.sort(
        (a, b) =>
          Math.abs(b.passport.automationReadiness.score - b.passport.productionReadiness.score) -
          Math.abs(a.passport.automationReadiness.score - a.passport.productionReadiness.score),
      );
    default:
      return base.sort((a, b) => a.project.name.localeCompare(b.project.name));
  }
}

// -- the wall↔cockpit tie-in: each project's context-health digest ---------------

export interface WallHealth {
  total: number;
  crit: number;
  warn: number;
  /** Contexts whose dominant tone is unmeasured — the "set up" tail. */
  unmeasured: number;
}

export function wallHealth(project: MockProject): WallHealth {
  const s = gridSummary(gridFor(project));
  return { total: s.total, crit: s.crit, warn: s.warn, unmeasured: s.unmeasured };
}
