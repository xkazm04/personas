/**
 * The bench's stand-in for the database.
 *
 * `curator_request` and `curator_plan_item` are both EMPTY today, so this
 * prototype carries its own material. Two things are fixed here and nothing
 * else: forty raw links as the operator would paste them, and what the cheap
 * pre-read pass eventually returns for each. Everything the surface shows is
 * derived from those by `useBench`.
 *
 * The plan rows are real: slugs, bundles, points and reason clauses taken from
 * `src-tauri/src/commands/curator/fixtures/librarian-scan.json` (the 471-subject
 * scan) so the queue's join lands on a bundle vocabulary that exists.
 */
import type { Bundle, PlanRow, Read } from './types';

/** The ten bundles, and whether consumers report demand in them (from the scan). */
export const BUNDLES: readonly Bundle[] = [
  { domain: 'software-engineering', demandKnown: true },
  { domain: 'llm-observability', demandKnown: true },
  { domain: 'game-production', demandKnown: true },
  { domain: 'localization', demandKnown: false },
  { domain: 'agent-operations', demandKnown: false },
  { domain: 'media-generation', demandKnown: false },
  { domain: 'marketing', demandKnown: false },
  { domain: 'grant-funding', demandKnown: false },
  { domain: 'civic-intelligence', demandKnown: false },
  { domain: 'recruiting', demandKnown: false },
];

/** Her plan, as the instrument would project it. Points are the scan's own. */
export const PLAN: readonly PlanRow[] = [
  { id: 'p1', domain: 'software-engineering', slug: 'agent-memory', points: 56, state: 'planned', marks: [{ channel: 7, points: 56 }] },
  { id: 'p2', domain: 'software-engineering', slug: 'quality-gates', points: 52, state: 'dispatched', marks: [{ channel: 7, points: 52 }] },
  { id: 'p3', domain: 'software-engineering', slug: 'accessibility', points: 44, state: 'planned', marks: [{ channel: 7, points: 44 }] },
  { id: 'p4', domain: 'llm-observability', slug: 'judge-calibration-and-drift', points: 16, state: 'planned', marks: [{ channel: 2, points: 6 }, { channel: 4, points: 4 }, { channel: 9, points: 6 }] },
  { id: 'p5', domain: 'llm-observability', slug: 'production-trace-scoring', points: 10, state: 'planned', marks: [{ channel: 2, points: 6 }, { channel: 4, points: 4 }] },
  { id: 'p6', domain: 'agent-operations', slug: 'agent-run-budgeting', points: 9, state: 'planned', marks: [{ channel: 4, points: 4 }, { channel: 5, points: 3 }, { channel: 8, points: 2 }] },
  { id: 'p7', domain: 'localization', slug: 'copy-quality-gates', points: 10, state: 'landed', marks: [{ channel: 2, points: 6 }, { channel: 5, points: 3 }, { channel: 9, points: 1 }] },
  { id: 'p8', domain: 'media-generation', slug: 'shot-continuity', points: 8, state: 'planned', marks: [{ channel: 4, points: 4 }, { channel: 5, points: 3 }, { channel: 9, points: 1 }] },
  { id: 'p9', domain: 'game-production', slug: 'encounter-pacing', points: 7, state: 'idled', marks: [{ channel: 5, points: 3 }, { channel: 8, points: 2 }, { channel: 9, points: 2 }] },
  { id: 'p10', domain: 'grant-funding', slug: 'reviewer-panel-design', points: 6, state: 'planned', marks: [{ channel: 2, points: 6 }] },
];

interface Seed {
  url: string;
  read: Read;
}

const r = (topic: string, domain: string): Read => ({ kind: 'read', topic, domain });

/**
 * Forty resources, in the order he pastes them. Thirty-three read, two carry no
 * topic, three cannot be read at all, and two are never reached because the
 * pre-read pass has a daily cap - which is an UNKNOWN that survives at rest,
 * not a transient shimmer.
 */
export const SEEDS: readonly Seed[] = [
  { url: 'https://arxiv.org/abs/2504.10925', read: r('Attention sink recovery in long contexts', 'llm-observability') },
  { url: 'https://martinfowler.com/articles/exploring-gen-ai.html', read: r('Exploratory practice with generative tools', 'software-engineering') },
  { url: 'https://research.google/blog/speculative-decoding-at-scale/', read: r('Speculative decoding at serving scale', 'llm-observability') },
  { url: 'https://docs.pytest.org/en/stable/how-to/fixtures.html', read: r('Fixture scoping and teardown order', 'software-engineering') },
  { url: 'https://vitepress.dev/guide/i18n', read: r('Routed locale trees for static docs', 'localization') },
  { url: 'https://openai.com/index/evals-design-notes/', read: r('Designing an eval that survives a model swap', 'llm-observability') },
  { url: 'https://web.dev/articles/inp', read: r('Interaction to next paint as a budget', 'software-engineering') },
  { url: 'https://blog.cloudflare.com/durable-objects-alarms/', read: r('Alarms as a durable scheduling primitive', 'software-engineering') },
  { url: 'https://unicode.org/reports/tr35/tr35-numbers.html', read: r('Plural and number pattern resolution', 'localization') },
  { url: 'https://arxiv.org/abs/2502.00881', read: r('Judge agreement under rubric drift', 'llm-observability') },
  { url: 'https://gdcvault.com/play/1029391/encounter-pacing', read: r('Encounter pacing curves in level design', 'game-production') },
  { url: 'https://github.com/anthropics/anthropic-sdk-typescript', read: r('Streaming tool-call assembly', 'llm-observability') },
  { url: 'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/', read: r('Combobox keyboard contract', 'software-engineering') },
  { url: 'https://sqlite.org/wal.html', read: r('Write-ahead logging and checkpoint starvation', 'software-engineering') },
  { url: 'https://example.internal/wiki/Team_Home', read: { kind: 'unreadable', why: 'host did not resolve' } },
  { url: 'https://kentcdodds.com/blog/stop-mocking-fetch', read: r('Test seams at the network boundary', 'software-engineering') },
  { url: 'https://arxiv.org/abs/2503.20783', read: r('Retrieval eviction under budget pressure', 'llm-observability') },
  { url: 'https://learn.microsoft.com/en-us/globalization/localizability/mirroring', read: r('Mirroring rules for right-to-left layouts', 'localization') },
  { url: 'https://grafana.com/docs/loki/latest/query/logql/', read: r('Log query shapes for cost attribution', 'llm-observability') },
  { url: 'https://news.ycombinator.com/item?id=39100001', read: { kind: 'nothing' } },
  { url: 'https://tauri.app/v2/reference/config/', read: r('Capability scoping for a desktop shell', 'software-engineering') },
  { url: 'https://www.nngroup.com/articles/progress-indicators/', read: r('When a wait needs a shape', 'software-engineering') },
  { url: 'https://arxiv.org/abs/2505.01122', read: r('Calibrating a generator against its own uncertainty', 'llm-observability') },
  { url: 'https://docs.ffmpeg.org/filters.html#concat', read: r('Concat demuxer versus filter graph', 'media-generation') },
  { url: 'https://www.figma.com/file/qq/Brand-System', read: { kind: 'unreadable', why: 'needs a sign-in the pass does not hold' } },
  { url: 'https://cldr.unicode.org/translation/date-time', read: r('Date skeletons and the era problem', 'localization') },
  { url: 'https://stripe.com/docs/billing/subscriptions/prorations', read: r('Proration on a mid-cycle plan change', 'software-engineering') },
  { url: 'https://arxiv.org/abs/2501.09876', read: r('Paged attention block reuse', 'llm-observability') },
  { url: 'https://www.gamedeveloper.com/production/milestone-scoping', read: r('Milestone scoping against a vertical slice', 'game-production') },
  { url: 'https://huggingface.co/blog/moe-routing', read: r('Expert routing collapse and its telltales', 'llm-observability') },
  { url: 'https://about.gitlab.com/handbook/engineering/infrastructure/', read: r('Runbook ownership at the team seam', 'software-engineering') },
  { url: 'https://drive.google.com/file/d/1aB/view', read: { kind: 'unreadable', why: 'the fetch returned a script shell, no document' } },
  { url: 'https://www.smashingmagazine.com/2024/09/css-container-queries/', read: r('Container queries over viewport breakpoints', 'software-engineering') },
  { url: 'https://openreview.net/forum?id=xYz123', read: r('Reward hacking in preference tuning', 'llm-observability') },
  { url: 'https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html', read: r('Blocking work off the async runtime', 'software-engineering') },
  { url: 'https://gist.github.com/someone/abc123', read: { kind: 'nothing' } },
  { url: 'https://www.elastic.co/blog/vector-search-recall', read: r('Recall floors for vector retrieval', 'llm-observability') },
  { url: 'https://reactnative.dev/architecture/fabric-renderer', read: r('Fabric renderer commit phases', 'software-engineering') },
  { url: 'https://www.ecma-international.org/publications-and-standards/standards/ecma-402/', read: r('Intl surface a locale pipeline can rely on', 'localization') },
  { url: 'https://arxiv.org/abs/2506.04411', read: r('Trace rollup and cost attribution', 'llm-observability') },
];

/** The paste box arrives holding them, so the first act on the bench is filing. */
export const PASTED = SEEDS.map((s) => s.url).join('\n');

/** From this index on, the daily cap stops the pre-read pass: those stay UNKNOWN. */
export const CAP_AT = 38;

/** The four registry skills this bench files with. `intake` is the bulk one. */
export const SKILLS = ['intake', 'research', 'conform', 'harvest'] as const;
export type SkillName = (typeof SKILLS)[number];
