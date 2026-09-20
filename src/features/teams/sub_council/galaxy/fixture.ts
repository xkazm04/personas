// The reference fixture — a DEV-only door, so the built page can be put beside
// `docs/design/council-reference/index.html` and compared pixel for pixel while
// the real store still holds zero councils.
//
// It FETCHES the two reference data files from the dev server rather than
// importing them, deliberately: a `?raw` import would bundle 1.3 MB of fixture
// into every production chunk that can reach this module, and a dynamic import
// would still emit the chunk. A fetch that only ever runs under `IS_DEV` emits
// nothing at all.
//
// Nothing here is ever written to the database, and the page says out loud
// that it is showing a fixture.
import type { CouncilOverlay } from '@/lib/bindings/CouncilOverlay';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import type { RegistryGalaxy } from '@/lib/bindings/RegistryGalaxy';

/** Read ONCE, at module scope — never inline at a JSX site. */
export const IS_DEV: boolean = import.meta.env.DEV;

const BASE = '/docs/design/council-reference/data';
export const FIXTURE_ROOT = '__council_reference_fixture__';

/**
 * `window.NAME = { … };` -> the object. The files are assignments, not JSON,
 * and the dev server serves them through its JS transform, which appends an
 * inline source map. So the object is found by scanning balanced braces from
 * the first `{` rather than by trimming the tail, which the map defeats.
 */
function parseAssignment(source: string, name: string): unknown {
  const marker = `window.${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`reference fixture: ${name} not found`);
  const open = source.indexOf('{', start + marker.length);
  if (open < 0) throw new Error(`reference fixture: ${name} is not an object assignment`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(open, i + 1));
    }
  }
  throw new Error(`reference fixture: ${name} is not balanced`);
}

/**
 * Initialisms the Rust reader upper-cases when it derives a title from a
 * slug. The fixture files carry titles that were pre-cased WITHOUT that step,
 * so `llm-agent` reads as "Llm Agent" here and "LLM Agent" in the product.
 * Applied to the FIXTURE ONLY, so the comparison view does not show a defect
 * the product does not have. Real data arrives already normalised and is
 * never passed through this.
 */
const INITIALISMS = new Set([
  'llm', 'ui', 'ci', 'cd', 'api', 'sql', 'mcp', 'p2p', 'ipc', 'pii', 'hitl', 'kpi', 'cx', 'ux', 'rtl',
]);

export function normaliseFixtureTitle(title: string): string {
  return title.replace(/[A-Za-z0-9]+/g, (word) =>
    INITIALISMS.has(word.toLowerCase()) ? word.toUpperCase() : word,
  );
}

/** The reference's `topology.js` is the same shape the Rust reader emits. */
interface FixtureTopology {
  totals: RegistryGalaxy['totals'];
  domains: RegistryGalaxy['domains'];
}

interface FixtureCouncil {
  subjects: Array<{
    project: string;
    kind: string;
    slug: string;
    title: string;
    tier: string | null;
    state: string;
    round_no: number;
    overall: number | null;
    coverage: number;
    trust_state: string;
    drift: string;
    latest_run_id?: string;
    decided_at?: string;
    rejection_reason?: string;
    registry_subjects: string[];
  }>;
  overlay: {
    subjects: Record<
      string,
      { approved: number; rejected: number; pending: number; techniques_proven: number; projects: string[]; last: string | null }
    >;
  };
}

export interface FixtureBundle {
  galaxy: RegistryGalaxy;
  overlay: CouncilOverlay;
  subjects: CouncilSubjectState[];
}

/**
 * Read one file through the dev server's `?raw` loader, NOT through `fetch`.
 *
 * A plain fetch of a `.js` path goes through the dev server's JS transform,
 * which rewrites the literals inside it: `0.7` comes back as `.7`, which is
 * valid JavaScript and invalid JSON. `?raw` returns the bytes on disk.
 * `@vite-ignore` keeps the specifier out of the production graph, so nothing
 * of the 1.3 MB fixture is bundled.
 */
async function readFixture(file: string, name: string): Promise<unknown> {
  const module = (await import(/* @vite-ignore */ `${BASE}/${file}?raw`)) as { default?: unknown };
  const source = module.default;
  if (typeof source !== 'string') throw new Error(`reference fixture: ${file} did not load as text`);
  return parseAssignment(source, name);
}

/**
 * Load the reference fixture. The two casts cross a data boundary and are
 * safe for one named reason: `docs/design/council-reference/data/SCHEMA.md`
 * fixes both shapes, the files are checked in beside it, and a mismatch
 * throws in `parseAssignment` before anything downstream sees it.
 */
export async function loadReferenceFixture(): Promise<FixtureBundle> {
  const [topologyRaw, councilRaw] = await Promise.all([
    readFixture('topology.js', 'TOPOLOGY'),
    readFixture('council-state.js', 'COUNCIL'),
  ]);
  const topology = topologyRaw as FixtureTopology;
  const council = councilRaw as FixtureCouncil;

  return {
    galaxy: {
      registryRoot: FIXTURE_ROOT,
      headSha: null,
      totals: topology.totals,
      domains: topology.domains.map((domain) => ({
        ...domain,
        title: normaliseFixtureTitle(domain.title),
        categories: domain.categories.map((category) => ({
          ...category,
          title: normaliseFixtureTitle(category.title),
          subjects: category.subjects.map((subject) => ({
            ...subject,
            title: normaliseFixtureTitle(subject.title),
          })),
        })),
      })),
    },
    overlay: {
      subjects: Object.entries(council.overlay.subjects).map(([slug, row]) => ({
        slug,
        approved: row.approved,
        rejected: row.rejected,
        pending: row.pending,
        techniquesProven: row.techniques_proven,
        projects: row.projects,
        last: row.last,
      })),
    },
    subjects: council.subjects.map((row) => ({
      id: `${row.project}:${row.slug}`,
      projectId: row.project,
      projectName: row.project,
      kind: row.kind,
      useCaseId: null,
      slug: row.slug,
      title: row.title,
      state: row.state,
      tier: row.tier,
      roundNo: row.round_no,
      latestRunId: row.latest_run_id ?? null,
      outcome: null,
      overall: row.overall,
      coverage: row.coverage,
      trustState: row.trust_state,
      floorHits: 0,
      hardFailures: 0,
      drift: row.drift,
      registrySubjects: row.registry_subjects,
      runDir: null,
      finishedAt: null,
      decidedAt: row.decided_at ?? null,
      rejectionReason: row.rejection_reason ?? null,
    })),
  };
}
