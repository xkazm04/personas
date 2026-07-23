// Onboard dispatch — the cover's "guided onboarding" door. Composes the
// dispatched-mode CONTEXT BLOCK the passport-onboard skill expects (project
// identity, dimension snapshot, dev_projects binding slots, available Vault
// connector METADATA — never secrets) and spawns a Fleet session in the
// project's repo root. One session per project, keyed `passport:onboard:<slug>`
// (same identity/dedup + terminal-door pattern as the R19 unified rows).
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

import type { ImproveRaw } from './improve/ImproveContext';
import {
  AUTOMATION_LABEL, PROD_BAND_LABEL, CI_LABEL, TESTS_LABEL, SECURITY_LABEL,
  OBSERVABILITY_LABEL, GRAPH_LABEL, EVALS_LABEL, MIGRATIONS_LABEL,
  MEMORY_LABEL, DOCS_LABEL,
  type AppPassport,
} from './passportModel';

export function onboardDispatchKey(slug: string): string {
  return `passport:onboard:${slug}`;
}

/** Vault credential metadata the dispatch may carry: id (for slot binding),
 *  name, service type. Credential VALUES never leave the vault. */
const CONNECTOR_TYPES = new Set([
  'sentry', 'datadog', 'betterstack', 'pagerduty', 'uptime_robot',
  'github', 'gitlab', 'azure_devops', 'circleci',
  'langfuse', 'helicone', 'langsmith', 'tracklight',
  'vercel', 'netlify', 'cloudflare', 'fly_io', 'railway', 'digitalocean', 'aws', 'firebase', 'kubernetes',
  'supabase', 'neon', 'postgres_proxy', 'convex', 'upstash',
]);

/** The shared dispatched-mode context block (identity, snapshot, slots,
 *  connector metadata) — used by the full onboarding door AND the per-row
 *  guided sessions. */
function composeContextBlock(p: AppPassport, raw: ImproveRaw, creds: PersonaCredential[]): string {
  const a = p.automationReadiness;
  const pr = p.productionReadiness;
  const proj = raw.project;

  const snapshot = [
    `Context coverage: ${GRAPH_LABEL[a.artifacts.contextGraph]}`,
    `Agent instructions: ${a.artifacts.agentInstructions.length ? 'present' : 'none'}`,
    `Documentation: ${DOCS_LABEL[a.artifacts.docs]}`,
    `Agent memory: ${MEMORY_LABEL[a.artifacts.memory]}`,
    `Evals: ${EVALS_LABEL[a.artifacts.evals]}`,
    `CI: ${CI_LABEL[pr.ci.level]}`,
    `Tests: ${TESTS_LABEL[pr.tests.level]}`,
    `Security: ${SECURITY_LABEL[pr.security.level]}`,
    `Observability: ${OBSERVABILITY_LABEL[pr.observability.level]}`,
    `Migrations: ${MIGRATIONS_LABEL[pr.delivery.migrations]}`,
    `Automation: ${a.level} (${AUTOMATION_LABEL[a.level]}) · Production: ${PROD_BAND_LABEL[pr.band]}`,
  ].join('\n- ');

  const slot = (id: string | null, label: string) => {
    if (!id) return `${label}: UNBOUND`;
    const c = creds.find((x) => x.id === id);
    return `${label}: bound to "${c?.name ?? id}" (${c?.serviceType ?? 'unknown'}, id ${id})`;
  };
  const slots = [
    slot(proj.monitoring_credential_id, 'monitoring_credential_id'),
    proj.monitoring_project_slug ? `monitoring_project_slug: ${proj.monitoring_project_slug}` : 'monitoring_project_slug: not set',
    slot(proj.pr_credential_id, 'pr_credential_id'),
    slot(proj.llm_tracking_credential_id, 'llm_tracking_credential_id'),
    proj.test_env_url ? `test env: ${proj.test_env_url}${proj.test_env_branch ? ` (branch ${proj.test_env_branch})` : ''}` : 'test env: none declared',
  ].join('\n- ');

  const connectors = creds
    .filter((c) => CONNECTOR_TYPES.has(c.serviceType))
    .map((c) => `{ id: ${c.id}, name: "${c.name}", service_type: ${c.serviceType} }`)
    .join('\n- ');

  return [
    '--- CONTEXT BLOCK (from the Personas passport wall) ---',
    `Project: ${p.identity.name} (${p.identity.slug})`,
    `Root: ${proj.root_path}`,
    proj.github_url ? `Repo: ${proj.github_url}` : 'Repo: no remote recorded',
    proj.tech_stack ? `Stack: ${proj.tech_stack}` : '',
    '',
    'Passport snapshot (trust these levels; do not re-derive what they already say):',
    `- ${snapshot}`,
    '',
    'dev_projects binding slots (the Vault is the credential source of truth — .env is runtime-only):',
    `- ${slots}`,
    '',
    connectors
      ? `Available Vault connectors (metadata only — ids reference encrypted vault entries, values NEVER move):\n- ${connectors}`
      : 'Available Vault connectors: none of the connector-flavored types exist yet — offering "add in Personas → Vault first" is the path for those dimensions.',
    '--- END CONTEXT BLOCK ---',
  ].filter(Boolean).join('\n');
}

const SHARED_TAIL = [
  'Binding note: you are a CLI session without app IPC. When a connector decision lands, name the EXACT binding (credential name + slot) as the single follow-up — the user binds it on the wall cell popover. If the local test-automation harness responds on http://127.0.0.1:17320, you may bind via IPC yourself per connectors.md.',
  'Finish by writing/refreshing the public-safe app-passport.json manifest (levels + tool names + skipped-by-choice only; never credential ids, URLs, costs, or local paths) and end your final report with the PASSPORT_ONBOARD_RESULT line.',
].join('\n');

export function buildOnboardPrompt(p: AppPassport, raw: ImproveRaw, creds: PersonaCredential[]): string {
  return [
    'Invoke the passport-onboard skill (/passport-onboard) and run it in DISPATCHED mode with the context block below. If the skill is not available in this environment, say so and stop — do not improvise the flow.',
    '',
    composeContextBlock(p, raw, creds),
    '',
    SHARED_TAIL,
  ].join('\n');
}

/** Per-row guided session — the skill scoped to ONE dimension. The operator
 *  is present in the terminal: the skill's batched selects render there and
 *  the run WAITS for answers (the same feedback loop as a full onboarding). */
export function buildDimensionOnboardPrompt(
  p: AppPassport,
  raw: ImproveRaw,
  creds: PersonaCredential[],
  dimension: { key: string; label: string },
  instruction?: string,
): string {
  return [
    `Invoke the passport-onboard skill (/passport-onboard) and run it in DISPATCHED mode SCOPED to a single dimension: **${dimension.label}**. If the skill is not available in this environment, say so and stop — do not improvise the flow.`,
    '',
    'Scoped-mode rules: assess ONLY this dimension (inline — no group assessors); present ONE decision round of selects (Skip · path A · path B with exactly one Recommended, Other stays first-class) and WAIT for the operator — they are watching this terminal; execute exactly what they accept; re-assess; refresh ONLY this dimension in app-passport.json.',
    instruction?.trim() ? `Operator instructions for this run: ${instruction.trim()}` : '',
    '',
    composeContextBlock(p, raw, creds),
    '',
    SHARED_TAIL,
  ].filter(Boolean).join('\n');
}
