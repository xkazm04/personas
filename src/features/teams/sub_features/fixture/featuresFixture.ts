// The reference fixture - a DEV-only door, so the built page can be put beside
// `docs/design/features-reference/b2-the-claim/index.html` and its sibling and
// compared while the real store holds almost no councils and no scenarios.
//
// Read through the dev server's `?raw` loader with `@vite-ignore`, exactly as
// `sub_council/galaxy/fixture.ts` does: a plain fetch of a `.js` path goes
// through Vite's JS transform, which rewrites `0.7` to `.7` - valid JavaScript
// and invalid JSON - and `?raw` returns the bytes on disk. `@vite-ignore` keeps
// the 110 KB out of every production chunk.
//
// The file is snake_case where the product binding is camelCase, so EVERY field
// is translated here, at the boundary. Typing the file as the product shape is
// what crashed the Council page once; these interfaces describe the file as it
// is on disk.
//
// Nothing here is ever written to the database.
import { SCENARIO_DEFAULT_FLOOR } from '@/api/devTools/features';
import type { BoardContext } from '@/lib/bindings/BoardContext';
import type { BoardEnvelope } from '@/lib/bindings/BoardEnvelope';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import type { BoardGroup } from '@/lib/bindings/BoardGroup';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';
import type { BoardScenarioResult } from '@/lib/bindings/BoardScenarioResult';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import type { FeatureBoard } from '@/lib/bindings/FeatureBoard';

/** Read ONCE, at module scope - never inline at a JSX site. */
export const IS_DEV: boolean = import.meta.env.DEV;

const BASE = '/docs/design/features-reference/data';

// ---------------------------------------------------------------------------
// The files as they are on disk (snake_case)
// ---------------------------------------------------------------------------

interface FileDimension {
  dimension: string;
  weight: number;
  state: string;
  score: number | null;
  floor: number | null;
  floor_hit: boolean;
}

interface FileCouncil {
  state: string;
  round_no?: number;
  overall?: number | null;
  coverage?: number;
  trust_state?: string;
  dimensions?: FileDimension[];
  history?: Array<{ round: number; overall: number | null }>;
  last_run?: string;
  decided_at?: string | null;
  rejection_reason?: string | null;
  drift?: string;
  top_finding?: string | null;
  running?: boolean;
  started_minutes_ago?: number;
}

interface FileFeature {
  slug: string;
  name: string;
  description: string;
  kind: string;
  tier: string;
  contexts: string[];
  primary_context: string;
  groups: string[];
  spend_30d_usd: number | null;
  council: FileCouncil;
}

interface FileContext {
  name: string;
  group: string;
  description: string;
  role: string;
  features: string[];
}

interface FileProject {
  key: string;
  name: string;
  totals: { contexts: number; groups: number; features: number; majors: number };
  groups: Array<{ name: string; contexts: number; features: number }>;
  contexts: FileContext[];
  features: FileFeature[];
}

interface FileBundle {
  threshold: number;
  projects: FileProject[];
}

interface FileScenarioResult {
  run_id: string;
  state: string;
  score: number | null;
  confidence: string;
  n: number | null;
  proof: string;
  summary: string;
}

interface FileScenario {
  slug: string;
  title: string;
  axes: Record<string, string>;
  scope: string;
  source: string;
  floor: number | null;
  latest: FileScenarioResult | null;
}

type FileScenarios = Record<string, FileScenario[]>;

// ---------------------------------------------------------------------------
// The fold - the TypeScript mirror of `aggregate_scenarios` (S3-S8)
// ---------------------------------------------------------------------------

/**
 * S6: a floor is HIT only by a `must_hold` row that was measured below it.
 * `tracked` never hits a floor; `proposed` and `out_of_scope` never compute one.
 */
export function fixtureFloorHit(scope: string, state: string, score: number | null, floor: number): boolean {
  return scope === 'must_hold' && state === 'measured' && score != null && score < floor;
}

/**
 * S8: every scenario lands in EXACTLY ONE bucket. The bucket floor is the
 * scenario's own floor for `must_hold` and a FLAT default for `tracked` - a
 * tracked branch is watched, not governed by a declared floor.
 *
 * This is the one place the Rust fold is mirrored in TypeScript, and only
 * because the fixture has no Rust behind it. The product path reads
 * `BoardFeature.envelope` and never calls this.
 */
export function foldFixtureEnvelope(scenarios: BoardScenario[]): BoardEnvelope {
  const env: BoardEnvelope = { holds: [], weak: [], unmeasured: [], outOfScope: [], proposed: [] };
  for (const s of scenarios) {
    if (s.scope === 'proposed') {
      env.proposed.push(s.slug);
      continue;
    }
    if (s.scope === 'out_of_scope') {
      env.outOfScope.push(s.slug);
      continue;
    }
    const measured = s.latest?.state === 'measured' && s.latest.score != null;
    if (!measured) {
      env.unmeasured.push(s.slug);
      continue;
    }
    const floor = s.scope === 'must_hold' ? s.floor : SCENARIO_DEFAULT_FLOOR;
    const score = s.latest?.score ?? 0;
    if (score >= floor) env.holds.push(s.slug);
    else env.weak.push(s.slug);
  }
  return env;
}

/** S4/S5/S6/S7 for one declared row plus the run that measured it. */
function foldScenario(row: FileScenario, trustState: string): BoardScenario {
  // S5 - every scope resolves a floor; only `must_hold` is failed by one.
  const floor = row.floor ?? SCENARIO_DEFAULT_FLOOR;
  let latest: BoardScenarioResult | null = null;
  if (row.latest) {
    // S4 - `measured` only when the report says so AND carries a number.
    const hasScore = typeof row.latest.score === 'number';
    const state = row.latest.state === 'measured' && hasScore ? 'measured' : 'unmeasured';
    const score = state === 'measured' ? Math.min(1, Math.max(0, row.latest.score ?? 0)) : null;
    const floorHit = fixtureFloorHit(row.scope, state, score, floor);
    latest = {
      runId: row.latest.run_id,
      state,
      score,
      confidence: row.latest.confidence,
      n: row.latest.n,
      proof: row.latest.proof,
      floorHit,
      // S7 - advisory is a CONJUNCTION: only ever true on a row whose floor
      // was hit, and only while the instrument is not trusted.
      advisory: floorHit && trustState !== 'trusted',
      summary: row.latest.summary,
    };
  }
  return {
    id: `fx-scenario-${row.slug}`,
    slug: row.slug,
    title: row.title,
    axes: row.axes,
    scope: row.scope,
    source: row.source,
    floor,
    latest,
  };
}

// ---------------------------------------------------------------------------
// The mapper
// ---------------------------------------------------------------------------

/** What the whole fixture hands the page. */
export interface FeaturesFixture {
  boards: FeatureBoard[];
  /** Feature slugs the fixture says have a live council session. The product
   *  overlays this from Fleet and never stores it. */
  runningSlugs: Set<string>;
}

/**
 * Map one file project into the product's `FeatureBoard`.
 *
 * Exported for its test: the mapper is the whole risk here, so it is driven
 * directly rather than through the loader.
 */
export function mapFixtureProject(project: FileProject, scenarios: FileScenarios): FeatureBoard {
  const slugByName = new Map<string, string>();
  for (const f of project.features) slugByName.set(f.name, f.slug);

  const coreByGroup = new Map<string, number>();
  let core = 0;
  let platform = 0;
  let tests = 0;
  let unclaimed = 0;
  const contexts: BoardContext[] = project.contexts.map((c) => {
    if (c.role === 'core') {
      core += 1;
      coreByGroup.set(c.group, (coreByGroup.get(c.group) ?? 0) + 1);
    } else if (c.role === 'platform') platform += 1;
    else if (c.role === 'tests') tests += 1;
    else unclaimed += 1;
    return {
      id: c.name,
      name: c.name,
      groupId: c.group,
      category: null,
      role: c.role,
      // The file names features by TITLE and the product by slug. A title with
      // no feature behind it is dropped rather than passed through as a slug
      // nothing resolves.
      featureSlugs: c.features.map((n) => slugByName.get(n)).filter((s): s is string => s != null),
    };
  });

  const groups: BoardGroup[] = project.groups.map((g) => ({
    id: g.name,
    name: g.name,
    domain: null,
    contextCount: g.contexts,
    featureCount: g.features,
    // Untouched is about CORE contexts, not about the group's feature count:
    // a group no feature's slice actually enters.
    untouched: (coreByGroup.get(g.name) ?? 0) === 0,
  }));

  let waitingOnYou = 0;
  let inTrouble = 0;
  const features: BoardFeature[] = project.features.map((f) => {
    const c = f.council;
    const everCouncilled = c.state !== 'none';
    if (c.state === 'ready' && f.tier === 'major') waitingOnYou += 1;
    if (c.state === 'fail' || c.state === 'stalled' || c.state === 'rejected' || c.state === 'approved_drifted') {
      inTrouble += 1;
    }
    const trustState = c.trust_state ?? 'uncalibrated';
    const council: CouncilSubjectState | null = everCouncilled
      ? {
          id: `fx-subject-${f.slug}`,
          projectId: `fixture:${project.key}`,
          kind: 'use_case',
          useCaseId: f.slug,
          slug: f.slug,
          title: f.name,
          state: c.state,
          tier: f.tier,
          roundNo: c.round_no ?? null,
          latestRunId: c.last_run ?? null,
          outcome: c.state,
          overall: c.overall ?? null,
          coverage: c.coverage ?? null,
          trustState,
          floorHits: (c.dimensions ?? []).filter((d) => d.floor_hit).length,
          hardFailures: 0,
          drift: c.drift ?? 'none',
          projectName: project.name,
          registrySubjects: [],
          runDir: null,
          finishedAt: c.last_run ?? null,
          decidedAt: c.decided_at ?? null,
          rejectionReason: c.rejection_reason ?? null,
        }
      : null;

    const rows = (scenarios[f.slug] ?? []).map((row) => foldScenario(row, trustState));
    return {
      id: f.slug,
      slug: f.slug,
      name: f.name,
      description: f.description,
      kind: f.kind,
      tier: f.tier,
      contextIds: f.contexts,
      groupIds: f.groups,
      primaryContextId: f.primary_context,
      council,
      verdicts: (c.dimensions ?? []).map((d) => ({
        dimension: d.dimension,
        kind: 'judged',
        state: d.state,
        score: d.score,
        weight: d.weight,
        floor: d.floor,
        floorHit: d.floor_hit,
        advisory: false,
      })),
      // Oldest first, as the binding promises.
      history: (c.history ?? []).map((h) => ({
        roundNo: h.round,
        overall: h.overall,
        outcome: c.state,
        finishedAt: c.last_run ?? '',
      })),
      scenarios: rows,
      // No scenarios is NOT an empty envelope - it is no envelope.
      envelope: rows.length > 0 ? foldFixtureEnvelope(rows) : null,
      // `dev_llm_spend` carries no use-case dimension, so the product always
      // reads null here. The fixture matches the product, not the file.
      spend30dUsd: null,
    };
  });

  return {
    projectId: `fixture:${project.key}`,
    projectName: project.name,
    totals: {
      contexts: contexts.length,
      groups: groups.length,
      features: features.length,
      majors: features.filter((f) => f.tier === 'major').length,
      core,
      platform,
      tests,
      unclaimed,
      waitingOnYou,
      inTrouble,
    },
    groups,
    contexts,
    features,
    neverScanned: false,
  };
}

/**
 * `window.NAME = { … };` -> the object. The files are assignments, not JSON,
 * and the dev server appends an inline source map, so the object is found by
 * scanning balanced braces from the first `{` rather than by trimming the tail.
 */
function parseAssignment(source: string, name: string): unknown {
  const marker = `window.${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`features fixture: ${name} not found`);
  const open = source.indexOf('{', start + marker.length);
  if (open < 0) throw new Error(`features fixture: ${name} is not an object assignment`);
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
  throw new Error(`features fixture: ${name} is not balanced`);
}

async function readFixture(file: string, name: string): Promise<unknown> {
  const module = (await import(/* @vite-ignore */ `${BASE}/${file}?raw`)) as { default?: unknown };
  const source = module.default;
  if (typeof source !== 'string') throw new Error(`features fixture: ${file} did not load as text`);
  return parseAssignment(source, name);
}

/**
 * Load the reference fixture. The two casts cross a data boundary and are safe
 * for one named reason: `docs/design/features-reference/data/SCHEMA.md` fixes
 * both shapes, the files are checked in beside it, and a shape mismatch throws
 * in `parseAssignment` before anything downstream sees it.
 */
export async function loadFeaturesFixture(): Promise<FeaturesFixture> {
  const [boardRaw, scenarioRaw] = await Promise.all([
    readFixture('features.js', 'FEATURES'),
    readFixture('scenarios.js', 'SCENARIOS'),
  ]);
  const bundle = boardRaw as FileBundle;
  const scenarios = scenarioRaw as FileScenarios;
  const runningSlugs = new Set<string>();
  for (const p of bundle.projects) {
    for (const f of p.features) if (f.council.running) runningSlugs.add(f.slug);
  }
  return {
    boards: bundle.projects.map((p) => mapFixtureProject(p, scenarios)),
    runningSlugs,
  };
}
