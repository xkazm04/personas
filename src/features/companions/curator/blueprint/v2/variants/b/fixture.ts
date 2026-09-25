/**
 * The local fixture this variant is drawn against.
 *
 * `curator_plan_run` and `curator_request` are both EMPTY in the database
 * today, so a prototype that read them would be a prototype of an empty state.
 * Every figure below is lifted verbatim from the registry's own scan
 * (`src-tauri/src/commands/curator/fixtures/librarian-scan.json`, 471 subjects,
 * 301 scoring): the ids, the taxonomy paths, the technique and application
 * counts, the stacks, the sweep dates, the demand blocks and - most
 * importantly - the scan's own clause sentences, kept word for word.
 *
 * It is shaped as a real `CuratorPlan` so it goes through the shipped
 * `buildModel()`. That is deliberate: the four-ink rule (count / measured zero
 * / unknown / unmeasurable) is decided in `model/buildModel.ts`, not here, so
 * this variant cannot accidentally invent a kinder truth than the app's.
 *
 * Six of the nine clauses occur in this corpus. Three - citation gone, expired
 * application, technique with no `use_when` - occur ZERO times, and that is a
 * measured zero rather than missing data. Two bundles below (`agent-operations`,
 * `localization`) report no demand, which is what makes channels 1 and 7
 * UNKNOWN for their subjects.
 */
import type { CuratorEngine } from '@/lib/bindings/CuratorEngine';
import type { CuratorPlan } from '@/lib/bindings/CuratorPlan';
import type { CuratorPlanItem } from '@/lib/bindings/CuratorPlanItem';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';
import type { CuratorReason } from '@/lib/bindings/CuratorReason';
import type { CuratorReasonCode } from '@/lib/bindings/CuratorReasonCode';
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';
import type { CuratorRequestState } from '@/lib/bindings/CuratorRequestState';

const RUN_ID = 'fixture-plan-run';
const SCAN_AT = '2026-09-22T22:39:52.343Z';

interface Seed {
  id: string;
  at: string;
  points: number;
  reasons: [CuratorReasonCode, number, string][];
  engine: CuratorEngine;
  techniques: number;
  applications: number;
  stacks: string[];
  lastSwept: string | null;
  demand: CuratorPlanItem['demand'];
}

const D = (consults: number, dev: number, summed: number, contributors: number): CuratorPlanItem['demand'] => ({
  consults,
  deviations: dev,
  deviationsSummed: summed,
  gone: 0,
  goneSummed: 0,
  contributors,
});

const DEV = 'consumer deviation(s)';
const SWEPT = 'never swept by the librarian';
const NO_APP = 'no application — never reconciled against real code';

/** Sixteen subjects, in the scan's own order of attention. */
const SEEDS: Seed[] = [
  { id: 'software-engineering/agent-memory', at: 'llm-agent/prompt-and-context/agent-memory', points: 56,
    reasons: [['deviation', 56, `14–28 ${DEV}`]], engine: 'conform',
    techniques: 27, applications: 27, stacks: ['bun', 'claude-code', 'node', 'python', 'rust', 'sql'],
    lastSwept: '2026-09-07', demand: D(6, 14, 28, 2) },
  { id: 'software-engineering/quality-gates', at: 'engineering-process/standards-and-gates/quality-gates', points: 52,
    reasons: [['deviation', 52, `13 ${DEV}`]], engine: 'conform',
    techniques: 26, applications: 26, stacks: ['claude-code', 'cpp', 'next', 'node', 'process', 'python', 'react', 'rust'],
    lastSwept: '2026-09-06', demand: D(7, 13, 13, 1) },
  { id: 'software-engineering/accessibility', at: 'ui-surfaces/feedback-and-style/accessibility', points: 44,
    reasons: [['deviation', 44, `11–17 ${DEV}`]], engine: 'conform',
    techniques: 8, applications: 6, stacks: ['react', 'rust'], lastSwept: '2026-09-01', demand: D(7, 11, 17, 2) },
  { id: 'software-engineering/markdown-vault', at: 'integration/embedded-surfaces/markdown-vault', points: 44,
    reasons: [['deviation', 44, `11–22 ${DEV}`]], engine: 'conform',
    techniques: 9, applications: 9, stacks: ['node', 'python', 'rust'], lastSwept: '2026-09-06', demand: D(4, 11, 22, 2) },
  { id: 'software-engineering/diff-comparison', at: 'ui-surfaces/data-display/diff-comparison', points: 43,
    reasons: [['deviation', 40, `10–20 ${DEV}`], ['never_swept', 3, SWEPT]], engine: 'conform',
    techniques: 8, applications: 8, stacks: ['next', 'react', 'rust'], lastSwept: null, demand: D(2, 10, 20, 2) },
  { id: 'llm-observability/operator-surfaces-for-llm-spend', at: 'federation-and-surfaces/operator-surfaces-for-llm-spend', points: 40,
    reasons: [['deviation', 40, `10–20 ${DEV}`]], engine: 'conform',
    techniques: 6, applications: 3, stacks: ['process', 'rust'], lastSwept: '2026-09-10', demand: D(4, 10, 20, 2) },
  { id: 'software-engineering/client-state', at: 'client-architecture/client-state', points: 40,
    reasons: [['deviation', 40, `10–14 ${DEV}`]], engine: 'conform',
    techniques: 12, applications: 13, stacks: ['next', 'react', 'rust'], lastSwept: '2026-09-05', demand: D(7, 10, 14, 2) },
  { id: 'software-engineering/fleet-orchestration', at: 'llm-agent/orchestration/fleet-orchestration', points: 32,
    reasons: [['deviation', 32, `8–16 ${DEV}`]], engine: 'conform',
    techniques: 18, applications: 13, stacks: ['node', 'process', 'python', 'react', 'rust'],
    lastSwept: '2026-09-10', demand: D(2, 8, 16, 2) },
  { id: 'software-engineering/terminal-multiplexing', at: 'llm-agent/runtime-and-io/terminal-multiplexing', points: 32,
    reasons: [['deviation', 32, `8–16 ${DEV}`]], engine: 'conform',
    techniques: 12, applications: 5, stacks: ['c', 'react', 'rust'], lastSwept: '2026-09-02', demand: D(2, 8, 16, 2) },
  { id: 'media-generation/production-pipeline-phasing', at: 'production-ops/production-pipeline-phasing', points: 28,
    reasons: [['deviation', 28, `7 ${DEV}`]], engine: 'conform',
    techniques: 6, applications: 4, stacks: ['node', 'react'], lastSwept: '2026-09-01', demand: D(4, 7, 7, 1) },
  { id: 'software-engineering/templates-scaffolding', at: 'integration/external-systems/templates-scaffolding', points: 21,
    reasons: [['deviation', 16, `4–8 ${DEV}`], ['never_swept', 3, SWEPT], ['single_stack', 2, 'single stack (react)']],
    engine: 'conform', techniques: 6, applications: 3, stacks: ['react'], lastSwept: null, demand: D(2, 4, 8, 2) },
  { id: 'software-engineering/connector-catalog', at: 'integration/external-systems/connector-catalog', points: 13,
    reasons: [['deviation', 8, `2 ${DEV}`], ['never_swept', 3, SWEPT], ['single_stack', 2, 'single stack (react)']],
    engine: 'conform', techniques: 6, applications: 3, stacks: ['react'], lastSwept: null, demand: D(1, 2, 2, 1) },
  { id: 'software-engineering/conditional-service-composition', at: 'operations/service-operations/conditional-service-composition', points: 13,
    reasons: [['no_application', 6, NO_APP], ['thin_techniques', 4, '3 techniques (design floor is 4)'], ['never_swept', 3, SWEPT]],
    engine: 'apply', techniques: 3, applications: 0, stacks: [], lastSwept: null, demand: D(1, 0, 0, 1) },
  { id: 'software-engineering/native-document-format', at: 'integration/acquisition-and-ingest/native-document-format', points: 9,
    reasons: [['no_application', 6, NO_APP], ['never_swept', 3, SWEPT]], engine: 'apply',
    techniques: 6, applications: 0, stacks: [], lastSwept: null, demand: D(1, 0, 0, 1) },
  { id: 'agent-operations/agent-benchmark-design', at: 'measurement/agent-benchmark-design', points: 9,
    reasons: [['thin_techniques', 4, '3 techniques (design floor is 4)'], ['never_swept', 3, SWEPT], ['single_stack', 2, 'single stack (process)']],
    engine: 'deepen', techniques: 3, applications: 1, stacks: ['process'], lastSwept: null, demand: null },
  { id: 'localization/translation-quality-measurement', at: 'craft/translation-quality-measurement', points: 6,
    reasons: [['no_application', 6, NO_APP]], engine: 'apply',
    techniques: 10, applications: 0, stacks: [], lastSwept: '2026-09-14', demand: null },
];

function itemOf(seed: Seed, i: number): CuratorPlanItem {
  const reasons: CuratorReason[] = seed.reasons.map(([code, weight, detail]) => ({ code, weight, detail }));
  return {
    id: `${RUN_ID}-${String(i)}`,
    planRunId: RUN_ID,
    subjectId: seed.id,
    domain: seed.id.split('/')[0] ?? '',
    at: seed.at,
    points: seed.points,
    reasons,
    dominantReason: seed.reasons[0]?.[0] ?? 'none',
    engine: seed.engine,
    techniques: seed.techniques,
    applications: seed.applications,
    stacks: seed.stacks,
    demandKnown: seed.demand !== null,
    demand: seed.demand,
    lastSwept: seed.lastSwept,
    registryDryStreak: 0,
    suppressedBySaturation: false,
    hasAppliedRow: false,
    state: 'planned',
    declinedReason: null,
    dispatchedRunId: null,
    evidenceRef: null,
    updatedAt: SCAN_AT,
  };
}

export const FIXTURE_POLICY: CuratorPolicy = {
  levelResearch: 'L2',
  levelForge: 'L0',
  levelConform: 'L1',
  levelSweep: 'L3',
  dailyBudgetUsd: 12,
  dailyRunCap: 40,
  dailyCommitCap: 8,
  quietHours: '23:00-07:00',
  backpressureN: 6,
  workerCap: 4,
};

export const FIXTURE_PLAN: CuratorPlan = {
  run: {
    id: RUN_ID,
    createdAt: '2026-09-25T08:14:02.000Z',
    scanGeneratedAt: SCAN_AT,
    registryHeadSha: 'f91ed00f',
    corpus: {
      generatedAt: SCAN_AT,
      today: '2026-09-22',
      subjects: 471,
      techniques: 3274,
      applications: 1825,
      domains: 10,
      demandKnownForAnyBundle: true,
      appliedSubjects: null,
      expiredApplications: 0,
      atRiskApplications: 1,
      driftUnknown: 0,
      drift: 0,
      noClockApplications: 612,
      demandKnownDomains: ['game-production', 'llm-observability', 'media-generation', 'recruiting', 'software-engineering'],
    },
    consumers: {
      generatedAt: SCAN_AT,
      mapsStale: false,
      projects: [
        { slug: 'personas', contexts: 215, pairs: 268, weak: 11, evaluated: 31, deviations: 14, staleVerdicts: 4, state: 'fresh', orphaned: 0 },
        { slug: 'knowledge-platform', contexts: 62, pairs: 88, weak: 3, evaluated: 12, deviations: 5, staleVerdicts: 1, state: 'fresh', orphaned: 0 },
      ],
      totals: { projects: 2, pairs: 356, evaluated: 43, weak: 14, staleVerdicts: 5, staleProjects: 0, orphaned: 0 },
      problems: [],
    },
    policy: FIXTURE_POLICY,
    itemCount: SEEDS.length,
    supersededBy: null,
  },
  items: SEEDS.map(itemOf),
  // The measured tail: subjects that score nothing on every channel that could
  // be measured. A fact about the subjects, not an absence of data.
  quiet: [
    { domain: 'software-engineering', subjects: 96, demandKnown: true },
    { domain: 'recruiting', subjects: 41, demandKnown: true },
    { domain: 'game-production', subjects: 33, demandKnown: true },
    { domain: 'marketing', subjects: 14, demandKnown: false },
    { domain: 'localization', subjects: 11, demandKnown: false },
  ],
};

/**
 * What the cheap pre-processing pass returned for one intake.
 *
 * Three states, not two, and they are three of the page's four inks: `read` is
 * a measurement, `unread` is an UNKNOWN (the pass has not run - which is what
 * forty freshly pasted URLs look like), and `barren` is an UNMEASURABLE (the
 * pass ran, fetched the resource and found nothing to name). A row that
 * collapsed the last two would be this surface telling the page's own lie.
 */
export type Enrichment =
  | { kind: 'read'; topic: string; domain: string }
  | { kind: 'unread' }
  | { kind: 'barren'; why: string };

export interface Intake {
  request: CuratorRequest;
  enrichment: Enrichment;
}

type IntakeSeed = [skill: string, argument: string | null, state: CuratorRequestState, enrichment: Enrichment];

const read = (topic: string, domain: string): Enrichment => ({ kind: 'read', topic, domain });
const unread: Enrichment = { kind: 'unread' };

// i18n: prototype fixture - one sitting of forty queued links plus six older rows.
const INTAKE_SEEDS: IntakeSeed[] = [
  ['intake', 'https://blog.vllm.ai/2026/06/paged-attention-v3.html', 'queued', read('Paged block cache, third generation', 'inference serving')],
  ['intake', 'https://arxiv.org/abs/2609.01144', 'queued', read('Speculative decoding under batch mutation', 'inference serving')],
  ['intake', 'https://www.sqlite.org/draft/wal3.html', 'queued', read('WAL3 and multi-writer embedded stores', 'embedded db')],
  ['intake', 'https://tauri.app/blog/tauri-3-0/', 'queued', read('Tauri 3 IPC contract changes', 'native shell integration')],
  ['intake', 'https://react.dev/blog/2026/05/12/react-20', 'queued', read('React 20 transitions and render mounting', 'render mount pipeline')],
  ['intake', 'https://github.com/openai/harmony/blob/main/SPEC.md', 'queued', read('Harmony response format', 'structured output')],
  ['intake', 'https://danluu.com/percentile-latency/', 'queued', read('Tail latency as a product decision', 'perf instrumentation')],
  ['intake', 'https://www.usenix.org/conference/osdi26/presentation/lease', 'queued', read('Cross-instance cache leases', 'cross instance cache lease')],
  ['intake', 'https://blog.cloudflare.com/durable-objects-alarms-2026/', 'queued', read('Alarms as durable agent timers', 'durable agent operations')],
  ['intake', 'https://simonwillison.net/2026/Aug/9/prompt-injection-again/', 'queued', read('Prompt injection in tool-using agents', 'prompt safety')],
  ['intake', 'https://web.dev/articles/view-transitions-scoped', 'queued', read('Scoped view transitions', 'motion')],
  ['intake', 'https://www.w3.org/TR/wai-aria-1.3/#grid', 'queued', read('Grid semantics for dense tables', 'accessibility')],
  ['intake', 'https://martinfowler.com/articles/2026-agent-review.html', 'queued', read('Plan review before agent execution', 'plan review')],
  ['intake', 'https://rustsec.org/advisories/RUSTSEC-2026-0031.html', 'queued', read('Advisory triage in a vendored tree', 'supply chain')],
  ['intake', 'https://engineering.fb.com/2026/07/21/data-infra/replicated-log/', 'queued', read('Transactions over a replicated log', 'transactions over a replicated log')],
  ['intake', 'https://news.ycombinator.com/item?id=44120933', 'queued', { kind: 'barren', why: 'a comment thread: no title, no abstract, nothing to name' }],
  ['intake', 'https://x.com/karpathy/status/1899210044', 'queued', { kind: 'barren', why: 'the page renders its text in script; the fetch returned a shell' }],
  ['intake', 'https://arxiv.org/abs/2608.20211', 'queued', unread],
  ['intake', 'https://arxiv.org/abs/2609.00418', 'queued', unread],
  ['intake', 'https://lwn.net/Articles/1029884/', 'queued', unread],
  ['intake', 'https://lwn.net/Articles/1030117/', 'queued', unread],
  ['intake', 'https://blog.rust-lang.org/2026/08/07/Rust-1.94.0.html', 'queued', unread],
  ['intake', 'https://go.dev/blog/synctest', 'queued', unread],
  ['intake', 'https://sqlite.org/forum/forumpost/2b9d10c4e1', 'queued', unread],
  ['intake', 'https://github.com/modelcontextprotocol/spec/pull/812', 'queued', unread],
  ['intake', 'https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/v1.9.0', 'queued', unread],
  ['intake', 'https://developer.chrome.com/blog/css-anchor-positioning-2026', 'queued', unread],
  ['intake', 'https://www.figma.com/blog/how-we-ship-design-tokens/', 'queued', unread],
  ['intake', 'https://vitejs.dev/blog/announcing-vite9', 'queued', unread],
  ['intake', 'https://tailwindcss.com/blog/tailwindcss-v4-2', 'queued', unread],
  ['intake', 'https://kubernetes.io/blog/2026/04/17/watch-cache-resync/', 'queued', unread],
  ['intake', 'https://grafana.com/blog/2026/05/03/otel-logs-ga/', 'queued', unread],
  ['intake', 'https://www.anthropic.com/research/agentic-misalignment-followup', 'queued', unread],
  ['intake', 'https://research.google/blog/speculative-cascades/', 'queued', unread],
  ['intake', 'https://huggingface.co/blog/quanto-2', 'queued', unread],
  ['intake', 'https://pytorch.org/blog/compiled-autograd-2026/', 'queued', unread],
  ['conform', 'personas', 'queued', read('Re-judge the Personas conformance map', 'conformance checking')],
  ['deepen', 'software-engineering/retry-backoff', 'queued', read('Earn techniques for retry and backoff', 'retry backoff')],
  ['forge', 'a subject for agent terminal multiplexing', 'queued', read('Forge: terminal multiplexing', 'terminal multiplexing')],
  ['harvest', null, 'queued', read('Drain the harvest queue', 'knowledge registry')],
  ['librarian', null, 'dispatched', read('Sweep every never-swept subject', 'knowledge registry')],
  ['intake', 'https://arxiv.org/abs/2607.14882', 'dispatched', read('Windowed inference over oversized inputs', 'windowed inference')],
  ['intake', 'https://blog.jetbrains.com/idea/2026/08/structural-search/', 'landed', read('Structural search as a census engine', 'codebase scanning')],
  ['hygiene', null, 'landed', read('Registry hygiene pass', 'knowledge registry')],
  ['intake', 'https://paywalled.example.com/report/2026-agent-spend', 'failed', { kind: 'barren', why: 'the fetch returned 402; nothing was read' }],
  ['conform', 'a repo this machine has no checkout of', 'declined', unread],
];

// The sitting is anchored to NOW rather than to a fixed instant, so the lane's
// elapsed times stay plausible however long after this file was written the
// prototype is opened. Fixture-only; the real rows carry the backend's clock.
const FILED_FROM = Date.now();

export const FIXTURE_INTAKES: Intake[] = INTAKE_SEEDS.map(([skill, argument, state, enrichment], i) => {
  const createdAt = new Date(FILED_FROM - (INTAKE_SEEDS.length - i) * 47_000).toISOString();
  const settled = state === 'landed' || state === 'failed' || state === 'declined' || state === 'cancelled';
  return {
    request: {
      id: `fixture-request-${String(i)}`,
      skill,
      argument,
      note: i === 0 ? 'the block-cache section is the part that matters' : null,
      state,
      createdAt,
      startedAt: state === 'queued' ? null : createdAt,
      settledAt: settled ? createdAt : null,
      sessionId: state === 'queued' ? null : `fleet-${String(i)}`,
      outcome: state === 'landed' ? 'ok' : null,
      resultRef: state === 'landed' ? `.ai/runs/${String(i)}/result.json` : null,
      failureReason: state === 'failed' ? 'the resource could not be fetched' : null,
    },
    enrichment,
  };
});
