// Populate dispatch — the passport's "populate this project's data" door.
//
// Sibling of onboardDispatch: same shape (compose a briefing from what the app
// already knows, hand it to a Claude session in the repo), different subject.
// Onboarding decides what a project SHOULD have; populate fills in what the app
// needs to work with the project at all — a context map, a feature inventory,
// and a triaged KPI set.
//
// The freshness gates are computed HERE rather than in the skill, for two
// reasons. The app can read the tables directly in one round trip, where the
// skill would spend turns deriving the same verdicts over HTTP. And a gate
// decided in the UI is a gate the user can see in the consent modal before
// anything runs — "context map: 3 months old, will re-scan incrementally" is
// the sentence that makes the action's cost predictable.
import { bridgePort, listContextGroups } from '@/api/devTools/devTools';
import { listKpis } from '@/api/devTools/kpis';
import { listUseCases } from '@/api/devTools/useCases';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { silentCatchNull } from '@/lib/silentCatch';

import type { ImproveRaw } from './improve/ImproveContext';
import type { AppPassport } from './passportModel';

/** Re-scan a lane whose newest artifact is older than this. */
const STALE_AFTER_DAYS = 14;

export function populateDispatchKey(slug: string): string {
  return `passport:populate:${slug}`;
}

/** Where the dispatch brief is written inside the target repo. */
export const POPULATE_BRIEF_PATH = 'project-populate/brief.md';

/** The four lanes a run can cover. The user picks any subset before dispatch;
 *  a lane left out is not run and not gated, and the skill reports it as out of
 *  scope rather than silently absent. */
export type PopulateLane = 'contexts' | 'features' | 'kpis' | 'simulation';

export const POPULATE_LANES: PopulateLane[] = ['contexts', 'features', 'kpis', 'simulation'];

/** `full` = never scanned · `incremental` = stale · `skip` = fresh enough. */
export type LaneVerdict = 'full' | 'incremental' | 'skip';

export interface PopulateGates {
  contexts: { verdict: LaneVerdict; groupCount: number; newestAt: string | null };
  /** Features have no incremental mode — a use-case scan is always a fresh pass. */
  features: { verdict: Exclude<LaneVerdict, 'incremental'>; count: number; proposed: number };
  kpis: { verdict: Exclude<LaneVerdict, 'incremental'>; active: number; proposed: number };
  /** Bridge port at compose time; null when local_http has not bound. */
  bridgePort: number | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  // SQLite `datetime('now')` has no zone suffix; treat it as UTC rather than
  // local, or every timestamp reads hours off depending on the user's offset.
  const normalized = /[Z+]|-\d{2}:\d{2}$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
  const then = Date.parse(normalized);
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 86_400_000;
}

/** Read the three lanes and decide what the run would actually do. */
export async function readPopulateGates(projectId: string): Promise<PopulateGates> {
  // A lane that fails to read is treated as empty, which reads as "there is
  // work to do here" — the safe direction. Claiming a lane is fresh because we
  // could not see it would silently skip the scan the project actually needs.
  const [groups, useCaseRows, kpiRows, port] = await Promise.all([
    listContextGroups(projectId),
    listUseCases(projectId).catch(silentCatchNull('populate gates: use cases')),
    listKpis(projectId).catch(silentCatchNull('populate gates: KPIs')),
    bridgePort(),
  ]);
  const useCases = useCaseRows ?? [];
  const kpis = kpiRows ?? [];

  const newestAt = groups.reduce<string | null>(
    (newest, g) => (g.updated_at && (!newest || g.updated_at > newest) ? g.updated_at : newest),
    null,
  );
  const age = daysSince(newestAt);
  const contextVerdict: LaneVerdict =
    groups.length === 0 ? 'full' : age !== null && age > STALE_AFTER_DAYS ? 'incremental' : 'skip';

  const proposedUseCases = useCases.filter((u) => u.status === 'proposed').length;
  // Nothing to slice yet means the feature lane cannot run either way, so it
  // reads as work to do rather than as fresh.
  const featureVerdict = useCases.length === 0 ? 'full' : 'skip';

  const activeKpis = kpis.filter((k) => k.status === 'active').length;
  const proposedKpis = kpis.filter((k) => k.status === 'proposed').length;
  const kpiVerdict = kpis.filter((k) => k.status !== 'archived').length === 0 ? 'full' : 'skip';

  return {
    contexts: { verdict: contextVerdict, groupCount: groups.length, newestAt },
    features: { verdict: featureVerdict, count: useCases.length, proposed: proposedUseCases },
    kpis: { verdict: kpiVerdict, active: activeKpis, proposed: proposedKpis },
    bridgePort: port,
  };
}

/** Lanes worth running by default: whatever the gates say needs work. A project
 *  whose contexts and features are current opens with only the KPI lane ticked,
 *  so the common case is one click rather than four deselections. Simulation
 *  stays off by default — it is the longest lane and only pays off once value
 *  KPIs are adopted, which has not happened yet at the moment of this choice. */
export function defaultLanes(g: PopulateGates): PopulateLane[] {
  const lanes: PopulateLane[] = [];
  if (g.contexts.verdict !== 'skip') lanes.push('contexts');
  if (g.features.verdict !== 'skip') lanes.push('features');
  if (g.kpis.verdict !== 'skip' || g.kpis.proposed > 0) lanes.push('kpis');
  // Everything current: default to the KPI lane rather than an empty run, since
  // triaging or re-proposing KPIs is the one thing always worth doing.
  return lanes.length > 0 ? lanes : ['kpis'];
}

/** One-line, user-facing summary of what each lane will do — the sentence that
 *  makes the action's cost predictable before the user confirms it. */
export function describeGates(g: PopulateGates): [contexts: string, features: string, kpis: string] {
  const contexts =
    g.contexts.verdict === 'full'
      ? 'Context map: none yet, will run a full scan.'
      : g.contexts.verdict === 'incremental'
        ? `Context map: ${g.contexts.groupCount} groups, last touched over ${STALE_AFTER_DAYS} days ago, will re-scan incrementally.`
        : `Context map: ${g.contexts.groupCount} groups and current, will be left alone.`;
  const features =
    g.features.verdict === 'full'
      ? 'Features: none yet, will propose an inventory.'
      : `Features: ${g.features.count} recorded${g.features.proposed > 0 ? ` (${g.features.proposed} awaiting your review)` : ''}, will be left alone.`;
  const kpis =
    g.kpis.verdict === 'full'
      ? 'KPIs: none yet, will propose a set and walk it with you.'
      : g.kpis.proposed > 0
        ? `KPIs: ${g.kpis.active} active, ${g.kpis.proposed} proposals to triage with you.`
        : `KPIs: ${g.kpis.active} active, nothing to triage.`;
  return [contexts, features, kpis];
}

const CONNECTOR_TYPES = new Set([
  'sentry', 'datadog', 'betterstack', 'pagerduty', 'uptime_robot',
  'github', 'gitlab', 'azure_devops', 'circleci',
  'langfuse', 'helicone', 'langsmith', 'tracklight',
  'posthog', 'amplitude', 'mixpanel', 'plausible',
]);

/** The brief written into the repo. Long enough that it must not travel on a
 *  command line — the invocation prompt just points at it. */
export function buildPopulateBrief(
  p: AppPassport,
  raw: ImproveRaw,
  creds: PersonaCredential[],
  gates: PopulateGates,
  lanes: PopulateLane[],
): string {
  const proj = raw.project;
  const connectors = creds
    .filter((c) => CONNECTOR_TYPES.has(c.serviceType))
    .map((c) => `- { id: ${c.id}, name: "${c.name}", service_type: ${c.serviceType} }`)
    .join('\n');

  const lane = (verdict: string, detail: string) => `${verdict.toUpperCase()} — ${detail}`;

  return [
    '# Dispatch brief: project-populate',
    '',
    'Composed by the Personas passport wall. The verdicts below were read from',
    "the app's own tables — trust them instead of re-deriving them.",
    '',
    '## Target',
    '',
    `- Project: ${p.identity.name} (${p.identity.slug})`,
    `- project_id: ${proj.id}`,
    `- Root: ${proj.root_path}`,
    proj.github_url ? `- Repo: ${proj.github_url}` : '- Repo: no remote recorded',
    proj.tech_stack ? `- Stack: ${proj.tech_stack}` : '',
    '',
    '## Bridge',
    '',
    gates.bridgePort
      ? `- Try \`http://127.0.0.1:${gates.bridgePort}/dev-tools\` first. If it stops answering, probe 17400-17415 — the port is chosen at startup and moves when it is taken. EVERY request needs the local token: read \`{port, token}\` from \`~/.personas/local-http.json\` and send \`X-Personas-Local-Token: <token>\`; a bare request is a 401, not a down app.`
      : '- The bridge was NOT bound when this brief was written. Probe 17400-17415; if nothing answers, Personas is not running and this run cannot proceed.',
    '',
    '## Scope',
    '',
    `The operator selected: **${lanes.join(', ')}**.`,
    '',
    ...POPULATE_LANES.filter((l) => !lanes.includes(l)).map(
      (l) => `- \`${l}\` is OUT OF SCOPE — do not run it, do not gate it, report it as out of scope.`,
    ),
    '',
    '## Lane verdicts',
    '',
    `- Contexts: ${lane(gates.contexts.verdict, `${gates.contexts.groupCount} group(s)${gates.contexts.newestAt ? `, newest updated ${gates.contexts.newestAt}` : ''}`)}`,
    `- Features: ${lane(gates.features.verdict, `${gates.features.count} recorded, ${gates.features.proposed} proposed`)}`,
    `- KPIs: ${lane(gates.kpis.verdict, `${gates.kpis.active} active, ${gates.kpis.proposed} proposed`)}`,
    '',
    'A `SKIP` verdict means the data is already there and current. Report it as',
    'skipped and move on — re-scanning it spends the operator’s tokens to churn',
    'something that was already right.',
    '',
    '## Monitoring available for Phase 4',
    '',
    connectors ||
      '- None. The project has no monitoring, error-tracking, CI or analytics connector in the Vault, so Phase 4 is a single recommendation rather than a wiring pass.',
    '',
    'Credential VALUES are not in this brief and never leave the vault. Ids and',
    'service types are enough to name a binding; the operator completes it on',
    'the passport wall.',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** The short invocation that travels as the session's first prompt. Kept free
 *  of shell metacharacters — it is passed as a process argument, and prose with
 *  `;` or `%` in it has historically been mangled by terminal wrappers. */
export function buildPopulatePrompt(lanes: PopulateLane[]): string {
  return (
    'The project-populate skill has just been installed into this repo ' +
    '(.claude/skills/project-populate). Invoke it with /project-populate and run it in ' +
    `DISPATCHED mode, scope ${lanes.join(',')}, following the dispatch brief at ${POPULATE_BRIEF_PATH}.`
  );
}
