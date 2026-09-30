// Passport Atlas — the pure half: which rows a lens shows, how a cell reads
// (with `unknown` for a checkout the probe could not read), the sorts, the
// counts, and the two headline findings. Ported from the /contest
// passport-wall-r2 winner (Signal Atlas), whose rules these are.
import { SECTIONS, type RowSpec, type SectionSpec } from '../passportRows';
import { inkKindOf, type InkKind } from '../passportInk';
import { sortByNameAsc, type AppPassport } from '../passportModel';
import { scoreAgainstRubric } from '../improve/goldenStandard';

export type AtlasInk = InkKind | 'unknown';
export type AtlasLens = 'readiness' | 'production' | 'automation' | 'stack' | 'tooling';
export type AtlasSort = 'production' | 'automation' | 'name' | 'gap';
export interface AtlasRow extends RowSpec { section: SectionSpec['key'] }

/** Body rows, in wall order; the two headline scores are the cover's, not rows. */
export const ATLAS_ROWS: AtlasRow[] = SECTIONS.flatMap((s) =>
  s.rows.filter((r) => !r.headline).map((r) => ({ ...r, section: s.key })));

/** Rows whose value comes from reading the repository. On an unreadable
 *  checkout they are unknown; rows read from the database stay known. */
const REPO_DEPENDENT = new Set([
  'languages', 'selfverify', 'docs', 'design-system', 'memory', 'skills',
  'evals', 'ci', 'tests', 'security', 'migrations', 'appcost',
]);

export function inkOf(p: AppPassport, row: RowSpec): AtlasInk {
  if (p.repoUnreadable && REPO_DEPENDENT.has(row.key)) return 'unknown';
  return inkKindOf(row.get(p));
}

export const countInk = (p: AppPassport, kind: AtlasInk) => ATLAS_ROWS.filter((r) => inkOf(p, r) === kind).length;

/** Dimensions that read "not set up" on every project: said once, folded out. */
export function sharedSetupRows(passports: AppPassport[]): AtlasRow[] {
  if (passports.length === 0) return [];
  return ATLAS_ROWS.filter((r) => passports.every((p) => inkOf(p, r) === 'setup'));
}

export function lensRows(lens: AtlasLens, folded: ReadonlySet<string>): AtlasRow[] {
  const rows = lens === 'readiness'
    // Production first: it is the axis most projects fail.
    ? [...ATLAS_ROWS.filter((r) => r.section === 'production'), ...ATLAS_ROWS.filter((r) => r.section === 'automation')]
    : ATLAS_ROWS.filter((r) => r.section === lens);
  return rows.filter((r) => !folded.has(r.key));
}

const auto = (p: AppPassport) => p.automationReadiness.score;
const prod = (p: AppPassport) => p.productionReadiness.score;

export function sortAtlas(passports: AppPassport[], sort: AtlasSort, query: string): AppPassport[] {
  const q = query.trim().toLowerCase();
  const hit = q
    ? passports.filter((p) => `${p.identity.name} ${p.identity.root ?? ''}`.toLowerCase().includes(q))
    : passports;
  if (sort === 'name') return sortByNameAsc([...hit]);
  const key = (p: AppPassport) => sort === 'automation' ? auto(p) : sort === 'production' ? prod(p) : -Math.abs(auto(p) - prod(p));
  // An unreadable checkout's scores are unverified: it sorts last, not first.
  return sortByNameAsc([...hit]).sort((a, b) =>
    Number(Boolean(a.repoUnreadable)) - Number(Boolean(b.repoUnreadable)) || key(a) - key(b));
}

/** "personas" three times is three checkouts: qualify a shared name by its folder. */
export function displayNames(passports: AppPassport[]): Map<string, { name: string; qualifier: string | null }> {
  const seen = new Map<string, number>();
  for (const p of passports) seen.set(p.identity.name, (seen.get(p.identity.name) ?? 0) + 1);
  return new Map(passports.map((p) => {
    const shared = (seen.get(p.identity.name) ?? 0) > 1;
    const folder = p.identity.root?.split(/[\\/]/).filter(Boolean).pop() ?? null;
    return [p.identity.slug, { name: p.identity.name, qualifier: shared && folder !== p.identity.name ? folder : shared ? 'main' : null }];
  }));
}

/** Readable projects with at least one failing or deficient body dimension. */
export const needCare = (passports: AppPassport[]) =>
  passports.filter((p) => !p.repoUnreadable && ATLAS_ROWS.some((r) => ['bad', 'warn'].includes(inkOf(p, r)))).length;

/** The portfolio's finding, for the page head: counts, never adjectives. */
export function portfolioFinding(passports: AppPassport[]) {
  const readable = passports.filter((p) => !p.repoUnreadable);
  return {
    projects: passports.length,
    belowGolden: readable.filter((p) => scoreAgainstRubric(p).goldenPct < 45).length,
    failingDims: ATLAS_ROWS.filter((r) => readable.some((p) => inkOf(p, r) === 'bad')).length,
  };
}

export const blockersOf = (p: AppPassport) => [...p.productionReadiness.blockers, ...p.automationReadiness.blockers];
