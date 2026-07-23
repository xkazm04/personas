// Test-only AppPassport factory for the Mastermind scene derivations. Produces
// a fully-absent baseline passport whose readiness dims can be dialed up one at
// a time via `overrides`, so each deriveScene status branch is exercised against
// a minimal, explicit fixture rather than the demo scene.
import type {
  AppPassport,
  AutomationLevel,
  CiLevel,
  ObservabilityLevel,
  SecurityLevel,
  TestsLevel,
} from '@/features/teams/sub_factory/passport/passportModel';

export interface PassportOverrides {
  slug?: string;
  name?: string;
  purpose?: string;
  autoScore?: number;
  prodScore?: number;
  automationLevel?: AutomationLevel;
  ciLevel?: CiLevel;
  ciProvider?: string | null;
  testsLevel?: TestsLevel;
  testsCoverage?: number | null;
  securityLevel?: SecurityLevel;
  securityTools?: string[];
  observabilityLevel?: ObservabilityLevel;
  monitoring?: Partial<AppPassport['stack']['monitoring']>;
  persistence?: AppPassport['stack']['persistence'];
  hosting?: string | null;
  auth?: string | null;
  llmTracking?: string | null;
  skills?: boolean;
}

/** A minimal passport whose every readiness dimension reads "absent" until an
 *  override dials it up. */
export function makePassport(o: PassportOverrides = {}): AppPassport {
  return {
    passport: 'app-passport',
    passportVersion: '1.0.0',
    identity: {
      name: o.name ?? 'Test Project',
      slug: o.slug ?? 'test-project',
      purpose: o.purpose ?? 'A fixture project',
      archetype: 'solo',
      lifecycle: 'beta',
      criticality: 'internal',
    },
    stack: {
      languages: [{ name: 'TypeScript', primary: true }],
      frameworks: [],
      persistence: o.persistence ?? [{ kind: 'none' }],
      monitoring: {
        errorTracking: null,
        logs: null,
        metrics: null,
        tracing: null,
        ...o.monitoring,
      },
      llmTracking: o.llmTracking ?? null,
      hosting: o.hosting ?? null,
      auth: o.auth ?? null,
      integrations: [],
    },
    automationReadiness: {
      level: o.automationLevel ?? 'L1',
      score: o.autoScore ?? 20,
      artifacts: {
        agentInstructions: [],
        contextGraph: 'none',
        memory: false,
        manifest: false,
        evals: 'none',
        skills: o.skills ?? false,
      },
      selfVerify: { build: false, test: false, lint: false, typecheck: false },
      aiInWorkflow: false,
      blockers: [],
    },
    productionReadiness: {
      band: 'internal',
      score: o.prodScore ?? 20,
      ci: { level: o.ciLevel ?? 'none', provider: o.ciProvider ?? null },
      tests: { level: o.testsLevel ?? 'none', coveragePct: o.testsCoverage ?? null },
      security: { level: o.securityLevel ?? 'none', tools: o.securityTools },
      observability: { level: o.observabilityLevel ?? 'none' },
      delivery: { migrations: 'none', iac: false, rollback: false },
      blockers: [],
    },
  };
}
