// The KPIs that speak about one feature under a lens (bp page/bits.tsx lensKpis, kpiHealth, scopeHit), and the code
// contexts the map carries (bp CodeTree / groupOfIn). The loaded structure keeps a feature's context NAMES only, so
// the contexts, their groups and files come from the raw map the seam hands over. Pure; no React.
import type { Feature, LensDef } from '../../standard/load';
import type { Context, Kpi } from '../../standard/types';

export type KpiHealth = 'bad' | 'watch' | 'good' | null;
export type ScopeHint = { kind: 'feature' } | { kind: 'context'; name: string } | { kind: 'group'; name: string } | { kind: 'project' } | { kind: 'read' };
export interface KpiView { k: Kpi; rank: 0 | 1 | 2 | 3; hint: ScopeHint; health: KpiHealth }

/** The map's code contexts by name (absent when the map carries none: the sample, a v3 map without a code tree). */
export function contextsOf(structure: unknown): Map<string, Context> {
  const raw = (structure as { contexts?: unknown } | null)?.contexts;
  const out = new Map<string, Context>();
  if (Array.isArray(raw)) for (const c of raw) if (c && typeof c === 'object' && typeof (c as Context).name === 'string') out.set((c as Context).name, c as Context);
  return out;
}

/** Where a KPI's scope meets this feature, per the spec's precedence (feature, context, group, project); null when it does not apply. */
function scopeHit(ctx: ReadonlyMap<string, Context>, f: Feature, k: Kpi): { rank: 0 | 1 | 2 | 3; hint: ScopeHint } | null {
  const s = k.scope as Record<string, unknown>;
  if (s.feature !== undefined) return s.feature === f.slug ? { rank: 0, hint: { kind: 'feature' } } : null;
  if (typeof s.context === 'string') return f.contexts.includes(s.context) ? { rank: 1, hint: { kind: 'context', name: s.context } } : null;
  if (typeof s.group === 'string') return f.contexts.some((c) => ctx.get(c)?.group === s.group) ? { rank: 2, hint: { kind: 'group', name: s.group } } : null;
  return s.project === true ? { rank: 3, hint: { kind: 'project' } } : null;
}

/**
 * A KPI's health from its thresholds: `direction` says which way is better (up: at or below warn_at is watch, at or
 * below crit_at is bad; down: the mirror). Without one it is read off the thresholds (crit below warn = up). One
 * threshold and no direction, none, or nothing measured: no health.
 */
export function kpiHealth(k: Kpi): KpiHealth {
  const v = k.current?.value, w = k.warn_at, c = k.crit_at;
  if (typeof v !== 'number' || (w === undefined && c === undefined)) return null;
  const dir = k.direction ?? (w !== undefined && c !== undefined && w !== c ? (c < w ? 'up' : 'down') : null);
  if (!dir) return null;
  const sign = dir === 'up' ? 1 : -1;
  if (c !== undefined && sign * (c - v) >= 0) return 'bad';
  if (w !== undefined && sign * (w - v) >= 0) return 'watch';
  return 'good';
}

/** The KPIs a lens's fields read, and those tagged with the lens whose scope applies; narrowest scope first, then name. */
export function lensKpis(kpis: readonly Kpi[], d: LensDef | undefined, f: Feature, ctx: ReadonlyMap<string, Context>): KpiView[] {
  const read = new Set<string>(), out: KpiView[] = [];
  for (const x of d?.fields ?? []) if (x.source && 'kpi' in x.source) read.add(x.source.kpi);
  for (const k of kpis) {
    const hit = scopeHit(ctx, f, k), isRead = read.has(k.slug);
    if (!isRead && !(d && k.lens === d.id && hit)) continue;
    out.push({ k, rank: hit?.rank ?? 3, hint: hit?.hint ?? { kind: 'read' }, health: kpiHealth(k) });
  }
  return out.sort((a, b) => a.rank - b.rank || a.k.name.localeCompare(b.k.name));
}
