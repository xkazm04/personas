// The findings ledger's one model (PORTED from bp src/components/ledger/useLedger.ts, its derivations as pure
// functions): every proposal of the store as a Finding read against the plan, the lens columns, the status counts,
// the filters, the packs (oldest first, each with its items and the ones the filters keep), the status chips of a
// scope, the matrix rows, the keyboard order and what a decision acts on. Nothing here writes: the store's statuses are
// shown as they are (no optimistic overlay; a write is followed by the sheet's re-read).
import type { Pack, Proposal, ProposalStatus, ScanSnapshot } from '@/lib/lensScan/wire';
import type { GlyphSpec } from '../engine/glyphs';
import type { Plan } from './plan';
import { byPackAge, LEDGER_STATUSES, OPEN_STATUSES, PACK_STATUSES, sizeW, V1_STATUSES } from './ledgerRules';

export type LedgerTab = 'triage' | 'matrix' | 'release';
export const LEDGER_TABS: readonly LedgerTab[] = ['triage', 'matrix', 'release'];
export type LedgerScope = 'packs' | 'backlog';

export interface Finding {
  p: Proposal;
  status: ProposalStatus;
  /** The feature's name in the map (the slug when the map lacks it). */
  fname: string;
  /** The feature's domain name ('' when the map lacks the feature). */
  domain: string;
  /** Map order of the feature (the matrix keeps it); far last when the map lacks it. */
  fi: number;
  /** The feature is on the plan (the L4 sheet can open it). */
  onPlan: boolean;
  /** Expected value per effort (the triage order within a status): rankValue. */
  ev: number;
  /** Still the backlog's to decide (proposed or approved). */
  can: boolean;
}

/** A matrix column and a filter chip: an enabled lens, or a lens id the findings name that the map does not enable. */
export interface LensCol { id: string; short: string; name: string; glyph: GlyphSpec; n: number; enabled: boolean }

export interface LedgerFilter { lens: ReadonlySet<string>; status: ReadonlySet<ProposalStatus>; feat: ReadonlySet<string>; q: string }
export const NO_FILTER: LedgerFilter = { lens: new Set(), status: new Set(), feat: new Set(), q: '' };
export const isFiltered = (f: LedgerFilter): boolean => !!(f.lens.size || f.status.size || f.feat.size || f.q);

/**
 * Expected value per effort (bp rankValue): ev = gain x confidence / effort, gain = 0.25 + 0.75 x |delta| / the
 * largest |delta| of the same lens and metric (0.5 without a delta), confidence = (11 - risk) / 10 (risk 5 when
 * missing), effort = the size weight (M when missing).
 */
export function rankValue(ps: readonly Proposal[]): Map<string, number> {
  const top = new Map<string, number>(), k = (p: Proposal) => p.lens + '\u0000' + p.metric;
  for (const p of ps) if (p.metric && p.expected_delta !== undefined) top.set(k(p), Math.max(top.get(k(p)) ?? 0, Math.abs(p.expected_delta)));
  const out = new Map<string, number>();
  for (const p of ps) {
    const t = p.metric && p.expected_delta !== undefined ? top.get(k(p)) ?? 0 : 0;
    const gain = t > 0 ? 0.25 + (0.75 * Math.abs(p.expected_delta ?? 0)) / t : 0.5;
    const risk = Math.min(10, Math.max(1, p.risk ?? 5));
    out.set(p.id, (gain * (11 - risk)) / 10 / sizeW(p));
  }
  return out;
}

export function buildFindings(scan: Pick<ScanSnapshot, 'proposals'>, plan: Plan): Finding[] {
  const dn = new Map(plan.S.domains.map((d) => [d.id, d.name]));
  const feats = new Map(plan.S.features.map((f, i) => [f.slug, { name: f.name, domain: dn.get(f.domain) ?? f.domain, i, on: !!plan.L.TILE[f.id] }]));
  const ev = rankValue(scan.proposals);
  return scan.proposals.map((p) => {
    const f = feats.get(p.feature);
    return { p, status: p.status, fname: f?.name ?? p.feature, domain: f?.domain ?? '', fi: f?.i ?? 1e6, onPlan: !!f?.on, ev: ev.get(p.id) ?? 0, can: OPEN_STATUSES.has(p.status) };
  });
}

export function lensCols(all: readonly Finding[], plan: Plan): LensCol[] {
  const n = new Map<string, number>();
  for (const f of all) n.set(f.p.lens, (n.get(f.p.lens) ?? 0) + 1);
  const meta = (id: string): Omit<LensCol, 'n'> => {
    const d = plan.LENS[id];
    return d ? { id, short: d.short, name: d.name, glyph: d.glyph, enabled: d.i >= 0 } : { id, short: id.replace(/^.*\./, '').slice(0, 4).toUpperCase(), name: id, glyph: null, enabled: false };
  };
  const cols = plan.lenses.map((l) => ({ ...meta(l.id), n: n.get(l.id) ?? 0 }));
  for (const [id, k] of n) if (!plan.LENS[id] || (plan.LENS[id]?.i ?? -1) < 0) cols.push({ ...meta(id), n: k });
  return cols;
}

export function statusCounts(all: readonly Finding[]): Record<ProposalStatus, number> {
  const c = Object.fromEntries(LEDGER_STATUSES.map((s) => [s, 0])) as Record<ProposalStatus, number>;
  for (const f of all) c[f.status] = (c[f.status] ?? 0) + 1;
  return c;
}

/** The filters as one predicate: lens, status, feature, and the text over title, feature, lens, standard, id, metric, pack. */
export function keeper(ui: LedgerFilter, plan: Plan): (f: Finding) => boolean {
  const q = ui.q.trim().toLowerCase();
  const text = (f: Finding) => [f.p.title, f.fname, f.p.feature, f.p.lens, plan.LENS[f.p.lens]?.name ?? '', f.p.standard, f.p.id, f.p.metric ?? '', f.p.pack_id ?? ''].join(' ').toLowerCase();
  return (f) => (!ui.lens.size || ui.lens.has(f.p.lens)) && (!ui.status.size || ui.status.has(f.status)) && (!ui.feat.size || ui.feat.has(f.p.feature)) && (!q || text(f).includes(q));
}

const byRank = (a: Finding, b: Finding) => b.ev - a.ev || (a.p.created_at < b.p.created_at ? -1 : a.p.created_at > b.p.created_at ? 1 : 0) || (a.p.id < b.p.id ? -1 : 1);
const RANK = new Map(LEDGER_STATUSES.map((s, i) => [s, i]));

/** The backlog's rows: kept, status order, then value per effort. */
export function triageRows(all: readonly Finding[], keep: (f: Finding) => boolean): Finding[] {
  return all.filter(keep).sort((a, b) => (RANK.get(a.status) ?? 99) - (RANK.get(b.status) ?? 99) || byRank(a, b));
}

export interface PackView { pack: Pack; items: Finding[]; shown: Finding[] }

/** The packs oldest first, each pack's items in created order (store.mjs `proposals --pack`), and the kept ones. */
export function packViews(all: readonly Finding[], packs: readonly Pack[], keep: (f: Finding) => boolean): { items: Finding[]; packs: PackView[] } {
  const by = new Map<string, Finding[]>(), items: Finding[] = [];
  for (const f of all) if (f.p.pack_id) { let a = by.get(f.p.pack_id); if (!a) by.set(f.p.pack_id, (a = [])); a.push(f); items.push(f); }
  const created = (a: Finding, b: Finding) => (a.p.created_at < b.p.created_at ? -1 : a.p.created_at > b.p.created_at ? 1 : a.p.id < b.p.id ? -1 : 1);
  const views = [...packs].sort(byPackAge).map((pack) => {
    const its = (by.get(pack.id) ?? []).sort(created);
    return { pack, items: its, shown: its.filter(keep) };
  });
  return { items, packs: views };
}

/** The status chips of a scope with their counts. */
export function chipsOf(scope: LedgerScope, counts: Record<ProposalStatus, number>, items: readonly Finding[]): { status: ProposalStatus; n: number }[] {
  if (scope === 'backlog') return LEDGER_STATUSES.filter((s) => V1_STATUSES.has(s) || counts[s]).map((status) => ({ status, n: counts[status] }));
  const c = new Map<ProposalStatus, number>();
  for (const f of items) c.set(f.status, (c.get(f.status) ?? 0) + 1);
  return PACK_STATUSES.map((status) => ({ status, n: c.get(status) ?? 0 }));
}

export interface MatrixRow { slug: string; name: string; domain: string; items: Finding[] }

/** The matrix's rows: one per feature with rows in the scope, in map order. */
export function matrixRows(rows: readonly Finding[]): MatrixRow[] {
  const m = new Map<string, MatrixRow & { fi: number }>();
  for (const f of rows) { let r = m.get(f.p.feature); if (!r) m.set(f.p.feature, (r = { slug: f.p.feature, name: f.fname, domain: f.domain, fi: f.fi, items: [] })); r.items.push(f); }
  return [...m.values()].sort((a, b) => a.fi - b.fi || (a.slug < b.slug ? -1 : 1)).map(({ fi: _fi, ...r }) => r);
}

/** The keyboard order (J/K) of the tab shown: a matrix row is `feat:<slug>`. */
export const ledgerOrder = (tab: LedgerTab, scoped: readonly Finding[]): string[] =>
  tab === 'matrix' ? matrixRows(scoped).map((r) => 'feat:' + r.slug) : tab === 'release' ? [] : scoped.map((f) => f.p.id);

/** The findings a focus id stands for: one, or a matrix row's. */
export const underFocus = (id: string | null, scoped: readonly Finding[]): string[] =>
  !id ? [] : id.startsWith('feat:') ? scoped.filter((f) => 'feat:' + f.p.feature === id).map((f) => f.p.id) : [id];

/** What a decision acts on: the selected ids of the scope, else the open item, else the focused one (bp targets). */
export function targetsOf(selected: readonly string[], open: string | null, focus: string | null, ids: ReadonlySet<string>): string[] {
  const sel = selected.filter((id) => ids.has(id));
  if (sel.length) return sel;
  if (open && ids.has(open)) return [open];
  return focus && ids.has(focus) ? [focus] : [];
}

/** One step of J/K through an order from the focus (the first or last when nothing is focused). */
export function stepIn(order: readonly string[], focus: string | null, d: number): string | null {
  if (!order.length) return null;
  const i = focus ? order.indexOf(focus) : -1;
  return order[i < 0 ? (d > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, i + d))] ?? null;
}
