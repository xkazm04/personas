// The ledger's Release tab, read-only (PORTED from bp src/components/ledger/train/release/releaseState.ts, the pure
// half): which release is the open one, the history, each package item's evidence (verdict, before -> after, flag), the
// step a release stands at, the suggested next version and the header's summary counts. bp's Build / Finish actions are
// not here: every write control opens bp's Release tab instead (operator decision, spark bp-fidelity).
import { verdictOf, type LensFields, type Verdict } from '@/lib/lensScan/compare';
import { suggestVersion } from '@/lib/lensScan/release';
import type { Measurement, Proposal, Release, ReleaseStatus, ScanSnapshot, VersionSuggestion } from '@/lib/lensScan/wire';
import { isFlagged, isWaiting, num } from './ledgerRules';

/** The five steps a release walks, in order; `failed` is shown at the building step. */
export const STEPS: readonly Exclude<ReleaseStatus, 'failed'>[] = ['draft', 'building', 'pr-open', 'merged', 'tagged'];
/** The step index of a status; -1 for failed. */
export const stepOf = (s: ReleaseStatus): number => (s === 'failed' ? -1 : STEPS.indexOf(s));
/** A failed release failed at its build (bp failedStep without the job: Personas does not read release jobs). */
export const FAILED_STEP = STEPS.indexOf('building');
/** A status whose items can no longer leave the release. */
export const isLocked = (s: ReleaseStatus): boolean => s !== 'draft';

/** The release the tab works on: the newest one that is not tagged. */
export function openRelease(rels: readonly Release[]): Release | undefined {
  for (let i = rels.length - 1; i >= 0; i--) { const r = rels[i]; if (r && r.status !== 'tagged') return r; }
  return undefined;
}

/** Tagged and failed releases other than the open one, newest first. */
export const historyOf = (rels: readonly Release[], open: Release | undefined): Release[] =>
  rels.filter((r) => r !== open && (r.status === 'tagged' || r.status === 'failed')).reverse();

export interface PkgItem { p: Proposal; verdict: Verdict; from?: Measurement; to?: Measurement; flagged: boolean }
type Readings = ReadonlyMap<string, { before: Measurement[]; after: Measurement[] }>;

/** Readings by proposal id and phase, one pass over the measurements. */
export function readingsBy(ms: readonly Measurement[]): Map<string, { before: Measurement[]; after: Measurement[] }> {
  const out = new Map<string, { before: Measurement[]; after: Measurement[] }>();
  for (const m of ms) {
    if (!m.proposal_id || !m.phase) continue;
    let e = out.get(m.proposal_id);
    if (!e) out.set(m.proposal_id, (e = { before: [], after: [] }));
    e[m.phase].push(m);
  }
  return out;
}

/** An item's evidence. Accepted from failed is still flagged: its build did not pass its gates. */
export function evidenceOf(p: Proposal, by: Readings, lenses: readonly LensFields[]): PkgItem {
  const e = by.get(p.id), v = verdictOf(p, e?.before ?? [], e?.after ?? [], lenses);
  const out: PkgItem = { p, verdict: v.verdict, flagged: isFlagged({ status: p.triaged_from === 'failed' ? 'failed' : p.status }, v.verdict) };
  if (v.from) out.from = v.from;
  if (v.to) out.to = v.to;
  return out;
}

/** Items grouped by lens, first seen first. */
export function byLens<T extends { p: Proposal }>(xs: readonly T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) { let a = m.get(x.p.lens); if (!a) m.set(x.p.lens, (a = [])); a.push(x); }
  return [...m];
}

/** A rework item a release's cherry-pick conflict sent back (its note says so). */
export const isConflict = (p: Pick<Proposal, 'triage_note'>): boolean => /^conflict on release\//.test(p.triage_note ?? '');

const byCreated = (a: Proposal, b: Proposal) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);

export interface ReleaseModel {
  rel?: Release;
  /** The package: the open release's items, or (no release yet) the accepted items with no release. */
  items: PkgItem[];
  /** Accepted items with no release (what a new draft takes). */
  free: number;
  history: Release[];
  rework: Proposal[];
  descoped: Proposal[];
  /** Rework id -> the rebuild that replaced it. */
  rebuiltBy: Map<string, string>;
  /** The version the tab shows: the open release's, else the suggestion. */
  suggestion: VersionSuggestion;
}

/** The tab's model, derived once per store read (bp useReleaseModel). */
export function releaseModel(scan: Pick<ScanSnapshot, 'proposals' | 'measurements' | 'releases'>, lenses: readonly LensFields[]): ReleaseModel {
  const rel = openRelease(scan.releases), by = readingsBy(scan.measurements);
  const free = scan.proposals.filter((p) => p.status === 'accepted' && !p.release_id).sort(byCreated);
  const pkg = rel ? scan.proposals.filter((p) => p.release_id === rel.id).sort(byCreated) : free;
  const rebuiltBy = new Map<string, string>();
  for (const p of scan.proposals) if (p.attempt_of) rebuiltBy.set(p.attempt_of, p.id);
  const m: ReleaseModel = {
    items: pkg.map((p) => evidenceOf(p, by, lenses)), free: free.length, history: historyOf(scan.releases, rel),
    rework: scan.proposals.filter((p) => p.status === 'rework'), descoped: scan.proposals.filter((p) => p.status === 'descoped' && !!p.pack_id),
    rebuiltBy, suggestion: suggestNext(scan.releases, free),
  };
  if (rel) m.rel = rel;
  return m;
}

/**
 * The suggested next version (bp asks git for its `v*` tags; Personas reads no git here): the tags of the store's
 * tagged releases stand in for them, newest version first, bumped by the accepted items with no release; a version
 * the store already has a release for is passed over.
 */
export function suggestNext(rels: readonly Release[], free: readonly Proposal[]): VersionSuggestion {
  const ver = (v: string) => v.split(/[.+-]/).slice(0, 3).map(Number);
  const tags = rels.filter((r) => r.status === 'tagged').map((r) => r.tag ?? 'v' + r.version)
    .sort((a, b) => { const x = ver(a.slice(1)), y = ver(b.slice(1)); return (y[0]! - x[0]!) || (y[1]! - x[1]!) || (y[2]! - x[2]!); });
  return suggestVersion(tags, undefined, free, new Set(rels.map((r) => r.version)));
}

/** The header's three counters (bp SummaryStrip): items built (and how many moved), waiting, and what will ship. */
export function summaryCounts(scan: Pick<ScanSnapshot, 'proposals' | 'measurements'>, lenses: readonly LensFields[]): { built: number; moved: number; waiting: number; failed: number; rework: number } {
  const by = readingsBy(scan.measurements);
  let built = 0, moved = 0, waiting = 0, failed = 0, rework = 0;
  for (const p of scan.proposals) {
    if (!p.pack_id) continue;
    if (p.status === 'failed') failed++;
    if (p.status === 'rework') rework++;
    if (isWaiting(p)) waiting++;
    if (p.status === 'released' || p.status === 'executing') continue;
    built++;
    const e = by.get(p.id);
    if (e && verdictOf(p, e.before, e.after, lenses).verdict === 'moved') moved++;
  }
  return { built, moved, waiting, failed, rework };
}

/** `before → after unit` for a package line; null when a side is missing (the caller says "unmeasured"). */
export function moveOf(x: Pick<PkgItem, 'from' | 'to'>): string | null {
  if (!x.from || !x.to) return null;
  return `${num(x.from.value)} → ${num(x.to.value)}${x.from.unit ? ' ' + x.from.unit : ''}`;
}

/**
 * The notes the release run will write, as a preview from the package (bp notesPreview). It is the run's own artifact,
 * Markdown in the store's language (English), shown as data in a code block, not as the sheet's prose.
 */
export function notesPreview(product: string, version: string, items: readonly PkgItem[], conflicts: readonly Proposal[]): string {
  const out = [`## ${product} ${version} (preview)`, '', `${items.length} change${items.length === 1 ? '' : 's'} from the lens release train, each measured before and after.`, ''];
  for (const x of items) {
    const p = x.p, u = x.from?.unit ? ' ' + x.from.unit : '';
    const move = x.from && x.to ? `${p.metric} ${num(x.from.value)} -> ${num(x.to.value)}${u} (${x.verdict})` : 'unmeasured';
    out.push(`- **${p.title}** · ${p.lens} · ${p.feature}: ${move} · commit ${p.commit_sha ? p.commit_sha.slice(0, 7) : 'none'}`);
    if (x.flagged && p.triage_note) out.push(`  - Shipped flagged: ${p.triage_note}`);
  }
  if (conflicts.length) {
    out.push('', '### Back to rework (cherry-pick conflict)');
    for (const p of conflicts) out.push(`- ${p.title}: ${p.triage_note ?? ''}`);
  }
  out.push('', '### Gates', `The release job runs the product's gates on release/${version} and lists them here.`);
  return out.join('\n') + '\n';
}

/** Rework items a release's cherry-pick conflict sent back (all of them with no open release). */
export const conflictsOf = (rework: readonly Proposal[], rel: Release | undefined): Proposal[] =>
  rework.filter((p) => isConflict(p) && (!rel || (p.triage_note ?? '').startsWith('conflict on ' + rel.branch)));
