// Real passport derivation — turns a live dev_tools project (its DevProject row
// + the cross-project-metadata scan output) into an App Readiness Passport.
//
// Every field is sourced from something the app actually observed:
//   · cross-project scan → tech_layers, db_tables, context_count, group_count,
//     keywords, active_goal_count, summary  (run via dev_tools_generate_cross_project_metadata)
//   · DevProject row     → standards_config (precommit + branching), github_url,
//     monitoring_credential_id, pr_credential_id, auto_pr_on_success, team_id
// Where there is NO signal the passport shows an explicit gap (null / 'none'),
// never an invented value — that honesty is the whole point of the comparison.
import type { CrossProjectProjectMetadata, RepoEvidence } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import {
  type AppPassport, type AutomationLevel, type ProdBand,
  type GraphLevel, type CiLevel, type IntegrationKind, type PassportIntegration,
  type PassportLanguage, type TestsLevel, type EvalsLevel, type MigrationsLevel,
  type SecurityLevel, type MemoryLevel, type DocsLevel,
  type AppCost, type EnvSlot, type PassportEnvironments,
} from './passportModel';
import { parseStandards } from './improve/standards';

const VENDOR_HINTS: Array<[RegExp, string, IntegrationKind]> = [
  [/stripe/i, 'Stripe', 'payments'],
  [/openai/i, 'OpenAI', 'llm'],
  [/anthropic|claude/i, 'Claude', 'llm'],
  [/supabase/i, 'Supabase', 'auth'],
  [/clerk/i, 'Clerk', 'auth'],
  [/twilio/i, 'Twilio', 'comms'],
  [/sendgrid|resend|postmark/i, 'Email', 'email'],
  [/posthog|segment|mixpanel/i, 'Analytics', 'analytics'],
  [/sentry/i, 'Sentry', 'other'],
];

/** Compact host for a URL-ish string ('https://x.fly.dev/a' → 'x.fly.dev');
 *  the raw value when it doesn't parse as a URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Lenient parse of the well-known `app-cost.json` (see APP_COST_FILENAME).
 *  null/undefined raw = file absent → null (the NA state). Invalid JSON =
 *  present-but-unreadable → empty services + parseError, never a throw. */
export function parseAppCost(raw: string | null | undefined): AppCost | null {
  if (raw == null) return null;
  try {
    const json = JSON.parse(raw) as { currency?: unknown; services?: unknown };
    const services = Array.isArray(json.services)
      ? json.services
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
          .map((s) => ({
            name: typeof s.name === 'string' && s.name.trim() ? s.name : 'unnamed',
            monthly: typeof s.monthly === 'number' && Number.isFinite(s.monthly) ? s.monthly : null,
            note: typeof s.note === 'string' ? s.note : undefined,
          }))
      : [];
    return { currency: typeof json.currency === 'string' ? json.currency : 'USD', services };
  } catch {
    return { currency: 'USD', services: [], parseError: true };
  }
}

function bandFromScore(score: number): ProdBand {
  if (score >= 85) return 'hardened';
  if (score >= 65) return 'production';
  if (score >= 45) return 'beta';
  if (score >= 25) return 'internal';
  return 'prototype';
}
function levelFromScore(score: number): AutomationLevel {
  if (score >= 75) return 'L5';
  if (score >= 58) return 'L4';
  if (score >= 40) return 'L3';
  if (score >= 22) return 'L2';
  return 'L1';
}

export function derivePassportFromMetadata(
  meta: CrossProjectProjectMetadata,
  project: DevProject,
  opts?: {
    hasSkills?: boolean;
    evidence?: RepoEvidence | null;
    skillCounts?: { reused: number; own: number; dormant?: number };
    docRot?: { tracked: number; dirty: number; neverRead: number };
    memHealth?: { score: number; prevScore: number | null; disputed: number; capturedAt: string };
  },
): AppPassport {
  const hasSkills = Boolean(opts?.hasSkills);
  // Deep evidence (D1) — real file signals from the repo probe. Null on older
  // builds / before the probe runs, in which case every read below falls back
  // to the prior heuristic, so the passport degrades gracefully.
  const ev = opts?.evidence ?? null;
  const layers = meta.tech_layers ?? [];
  const has = (l: string) => layers.includes(l);
  const std = parseStandards(project.standards_config);
  const precommit = std.precommit;
  const automerge = std.branching.automerge;

  // -- stack ------------------------------------------------------------------
  const languages: PassportLanguage[] = [];
  if (has('typescript')) languages.push({ name: 'TypeScript', primary: true });
  if (has('rust-backend')) languages.push({ name: 'Rust', primary: languages.length === 0 });
  if (languages.length === 0) languages.push({ name: project.tech_stack === 'react' ? 'JavaScript' : 'Unknown', primary: true });

  const frameworks: string[] = [];
  if (project.tech_stack === 'react' || has('frontend')) frameworks.push('React');
  if (has('node-backend')) frameworks.push('Node');
  if (has('rust-backend')) frameworks.push('Tauri');
  const runtime = [has('node-backend') || has('frontend') ? 'node' : null, has('rust-backend') ? 'rust' : null]
    .filter(Boolean).join(' + ') || undefined;

  const dbCount = meta.db_tables?.length ?? 0;
  // Persistence renders as the DB tech ICON (TechBadge), not a word + table
  // count — the engine name alone resolves to the brand glyph; the table count
  // isn't a readiness signal so it's dropped from the label.
  const persistence = (dbCount > 0 || has('database'))
    ? [{
        kind: 'relational' as const,
        engine: has('rust-backend') ? 'SQLite' : 'SQL',
        orm: null,
        migrations: 'none' as const,
        required: true,
      }]
    : [];

  const integrations: PassportIntegration[] = [];
  if (project.github_url) integrations.push({ name: 'GitHub', kind: 'vcs', direction: 'bidirectional' });
  if (project.pr_credential_id || project.auto_pr_on_success) integrations.push({ name: 'Auto-PR', kind: 'ci-cd', direction: 'outbound' });
  if (project.monitoring_credential_id) integrations.push({ name: 'Monitoring', kind: 'analytics', direction: 'inbound' });
  const haystack = (meta.keywords ?? []).concat(meta.api_surface ?? []).join(' ').toLowerCase();
  for (const [re, name, kind] of VENDOR_HINTS) {
    if (re.test(haystack) && !integrations.some((i) => i.name === name)) integrations.push({ name, kind, direction: 'outbound' });
  }

  // -- automation readiness (the headline axis) -------------------------------
  const contextGraph: GraphLevel = meta.context_count >= 20 ? 'full' : meta.context_count >= 5 ? 'partial' : 'none';
  const selfVerify = {
    build: layers.length > 0,
    test: ev?.has_tests ?? false, // real: a test suite/script was detected
    lint: Boolean(precommit.lint),
    typecheck: Boolean(precommit.code_quality),
  };
  const aiInWorkflow = Boolean(project.auto_pr_on_success) || Boolean(project.team_id) || Boolean(project.pr_credential_id);
  const hasManifest = Boolean(project.standards_config);
  // Real CLAUDE.md beats the team_id heuristic for "agent instructions exist".
  const agentInstructions = [
    ev?.has_claude_md ? 'CLAUDE.md' : null,
    project.team_id ? 'team policy' : null,
  ].filter(Boolean) as string[];
  const evalsLevel: EvalsLevel = ev?.has_eval ? 'partial' : 'none';

  // Agent memory (Brainiac-adoption P0) — graded from the probe. `curated`
  // needs an index with real entries that changed recently; `governed` is
  // unreachable until the P3 review/decay loop exists (the ladder shows the
  // rung so the target is visible). Probe fields are optional — an older
  // backend yields "no signal", never an invented level.
  const memFiles = ev?.memory_file_count ?? 0;
  const memIndex = ev?.memory_index_lines ?? 0;
  const memAge = ev?.memory_age_days ?? null;
  // `governed` (P3): the review/decay/claims loop is demonstrably RUNNING for
  // this project — a fresh knowledge-health snapshot exists for its bound
  // team. Requires the curated bar first; the snapshot alone doesn't make
  // sloppy memory governed.
  const curated = memIndex >= 5 && memAge != null && memAge <= 30;
  const memoryLevel: MemoryLevel = !(ev?.has_repo_memory || memFiles > 0) ? 'none'
    : curated && opts?.memHealth ? 'governed'
    : curated ? 'curated'
    : 'adhoc';

  // Documentation (P0) — a doc-map manifest means freshness is *managed*
  // (source→doc coupling exists), which outranks raw volume. The 'fresh'
  // rot-scan rung arrives with the P2 git-based dirty scan.
  const docsCount = ev?.docs_file_count ?? 0;
  const docsLevel: DocsLevel = ev?.has_doc_map && docsCount > 0 ? 'synced'
    : docsCount >= 3 ? 'structured'
    : ev?.has_readme ? 'readme'
    : 'none';

  const autoScore = Math.min(100,
    (contextGraph === 'full' ? 35 : contextGraph === 'partial' ? 18 : 0)
    + Object.values(selfVerify).filter(Boolean).length * 7
    + (aiInWorkflow ? 18 : 0)
    + (hasManifest ? 10 : 0)
    + (hasSkills ? 8 : 0)
    + (evalsLevel !== 'none' ? 7 : 0)
    + (ev?.has_claude_md ? 6 : 0)
    + (meta.active_goal_count > 0 ? 9 : 0)
    + (memoryLevel === 'governed' ? 9 : memoryLevel === 'curated' ? 7 : memoryLevel === 'adhoc' ? 3 : 0)
    + (docsLevel === 'synced' ? 8 : docsLevel === 'structured' ? 5 : docsLevel === 'readme' ? 2 : 0),
  );

  // -- production readiness ---------------------------------------------------
  let ciLevel: CiLevel = automerge.enabled ? 'delivery'
    : std.branching.pr_base ? 'gated'
    : (precommit.lint || precommit.code_quality) ? 'checks'
    : 'none';
  // Real CI workflow files lift a config-less project to at least "checks".
  if (ciLevel === 'none' && (ev?.ci_workflows.length ?? 0) > 0) ciLevel = 'checks';
  const ciGates = [
    precommit.lint ? 'lint' : null,
    precommit.code_quality ? 'code-quality' : null,
    precommit.docs_required ? 'docs' : null,
    automerge.enabled ? 'automerge' : null,
    (ev?.ci_workflows.length ?? 0) > 0 ? 'github-actions' : null,
  ].filter(Boolean) as string[];
  const observabilityLevel = project.monitoring_credential_id ? 'errors' as const : 'none' as const;
  // Dependency / code scanning (Dependabot / CodeQL) is real "scanning"; a bare
  // standards policy is "policy"; otherwise none.
  const securityLevel: SecurityLevel = (ev?.has_codeql || ev?.has_dependabot) ? 'scanning'
    : project.standards_config ? 'policy' : 'none';
  // Tests graded by detected file count; migrations from a detected framework/dir.
  const testsLevel: TestsLevel = !ev?.has_tests ? 'none'
    : ev.test_file_count >= 20 ? 'substantial'
    : ev.test_file_count >= 5 ? 'partial'
    : 'smoke';
  const migrationsLevel: MigrationsLevel = ev?.has_migrations ? 'scripted' : 'none';
  const securityTools = [
    ev?.has_codeql ? 'CodeQL' : null,
    ev?.has_dependabot ? 'Dependabot' : null,
    project.standards_config ? 'standards_config' : null,
  ].filter(Boolean) as string[];

  const prodScore = Math.min(100,
    (ciLevel === 'delivery' ? 30 : ciLevel === 'gated' ? 22 : ciLevel === 'checks' ? 10 : 0)
    + (securityLevel === 'scanning' ? 16 : securityLevel === 'policy' ? 10 : 0)
    + (observabilityLevel === 'errors' ? 18 : 0)
    + (testsLevel === 'substantial' ? 16 : testsLevel === 'partial' ? 10 : testsLevel === 'smoke' ? 5 : 0)
    + (migrationsLevel === 'scripted' ? 4 : 0)
    + (dbCount > 0 ? 8 : 0),
  );

  // -- honest blockers (feed the Wall's "Why it's not ready" band) ------------
  const autoBlockers: string[] = [];
  if (contextGraph !== 'full') autoBlockers.push('Context coverage incomplete — rescan to map the whole repo');
  if (!selfVerify.test) autoBlockers.push('No automated test signal an agent can self-verify against');
  if (!aiInWorkflow) autoBlockers.push('No automated PR / team pipeline wired');
  if (!hasManifest) autoBlockers.push('No standards & branching policy set');
  if (docsLevel === 'none') autoBlockers.push('No documentation an agent can ground in');

  const prodBlockers: string[] = [];
  if (observabilityLevel === 'none') prodBlockers.push('No error tracking / monitoring connector bound');
  if (testsLevel === 'none') prodBlockers.push('No automated test suite detected');
  if (securityLevel === 'none') prodBlockers.push('No security policy or scanning');
  if (ciLevel === 'none' || ciLevel === 'checks') prodBlockers.push('Merges are not gated by checks');

  const lifecycle = meta.context_count >= 25 ? 'beta' : meta.context_count >= 8 ? 'alpha' : 'prototype';

  // -- environments (local / test / production) — only what was OBSERVED ------
  // A slot stays null (an honest empty state) unless something real backs it:
  // a repo-detected db engine runs in dev at minimum; a dev/start script is a
  // local host signal; test_env_url is the test host; a bound monitoring
  // connector watches the DEPLOYED app, so it fills the production slot.
  const slot = (label: string | null, sub?: string): EnvSlot => (sub ? { label, sub } : { label });
  const environments: PassportEnvironments = {
    db: {
      local: slot(persistence[0]?.engine ?? null),
      test: slot(null),
      production: slot(null),
    },
    monitoring: {
      local: slot(null),
      test: slot(null),
      production: slot(project.monitoring_credential_id ? 'connected' : null),
    },
    hosting: {
      local: slot(ev?.package_scripts.some((s) => s === 'dev' || s === 'start') ? 'dev script' : null),
      test: slot(project.test_env_url ? hostOf(project.test_env_url) : null),
      production: slot(null),
    },
  };

  return {
    passport: 'app-passport',
    passportVersion: '0.1.0',
    generatedBy: 'dev_tools cross-project scan + project config',
    identity: {
      name: meta.name,
      slug: meta.project_id,
      purpose: (meta.summary && meta.summary.trim()) || (meta.keywords ?? []).slice(0, 4).join(', ') || 'Dev-tools project',
      repo: meta.github_url ?? undefined,
      archetype: project.team_id ? 'team' : 'solo',
      lifecycle,
      criticality: project.team_id ? 'business' : 'internal',
    },
    stack: {
      languages,
      runtime,
      frameworks,
      persistence,
      monitoring: {
        // A bound monitoring connector (Datadog/Grafana/Sentry/…) covers the
        // whole observability surface — so it lights up all four tooling rows,
        // not just error-tracking. Without one, each is an explicit gap.
        errorTracking: project.monitoring_credential_id ? 'connected' : null,
        logs: project.monitoring_credential_id ? 'connected' : null,
        metrics: project.monitoring_credential_id ? 'connected' : null,
        tracing: project.monitoring_credential_id ? 'connected' : null,
        uptime: project.test_env_url ?? null,
      },
      // LLM-observability connector — its own credential slot (distinct from
      // app monitoring); 'connected' once a credential is bound.
      llmTracking: project.llm_tracking_credential_id ? 'connected' : null,
      hosting: project.test_env_url ? 'test env' : null,
      // Auth method detected from the repo's dependencies (view-only).
      auth: ev?.auth_method ?? null,
      integrations,
      environments,
      appCost: parseAppCost(ev?.app_cost_raw),
    },
    automationReadiness: {
      level: levelFromScore(autoScore),
      score: autoScore,
      artifacts: {
        agentInstructions,
        contextGraph,
        memory: memoryLevel,
        docs: docsLevel,
        manifest: hasManifest,
        evals: evalsLevel,
        skills: hasSkills,
        skillCounts: opts?.skillCounts,
        docRot: opts?.docRot,
        memoryHealth: opts?.memHealth
          ? { score: opts.memHealth.score, prevScore: opts.memHealth.prevScore, disputed: opts.memHealth.disputed }
          : undefined,
      },
      selfVerify,
      aiInWorkflow,
      blockers: autoBlockers,
    },
    productionReadiness: {
      band: bandFromScore(prodScore),
      score: prodScore,
      ci: { level: ciLevel, provider: project.github_url ? 'github-actions' : null, gates: ciGates },
      tests: { level: testsLevel, coveragePct: null, frameworks: ev?.test_framework ? [ev.test_framework] : [], criticalPathCovered: testsLevel === 'substantial' },
      security: { level: securityLevel, tools: securityTools },
      observability: { level: observabilityLevel },
      delivery: { migrations: migrationsLevel, iac: ev?.has_dockerfile ?? false, rollback: Boolean(automerge.enabled) },
      blockers: prodBlockers,
    },
    // Provenance: how much of this passport is backed by real observation. Higher
    // when the scan found context + tech layers and the project has a config
    // policy; lower when it's mostly gaps. Per-dimension reasons live in
    // improve/provenance.ts; this is the headline confidence for the report.
    evidence: {
      confidence: Math.min(1, 0.45
        + (meta.context_count >= 5 ? 0.2 : 0)
        + (layers.length > 0 ? 0.15 : 0)
        + (project.standards_config ? 0.2 : 0)),
      source: 'dev_tools cross-project scan + project config',
      files: meta.db_tables ?? [],
    },
  };
}
