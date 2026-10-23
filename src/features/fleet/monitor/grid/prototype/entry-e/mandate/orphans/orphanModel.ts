// The orphanage in words (mandate-lanes WP6): a cluster's line, why it asks
// for a mandate (the backend's law: `large` / `growing` against the fleet's
// flow), and the choices adopt and draft offer. React-free.

import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { OrphanCluster } from '@/lib/bindings/OrphanCluster';
import type { Translations } from '@/i18n/generated/types';

type M = Translations['monitor'];
type Tx = (tpl: string, vars: Record<string, string | number>) => string;

const KIND_WORD: Record<string, keyof M> = {
  idea: 'ml_orphans_kind_idea',
  review: 'ml_orphans_kind_review',
  incident: 'ml_orphans_kind_incident',
  report: 'ml_orphans_kind_report',
  council: 'ml_orphans_kind_council',
  goal: 'ml_orphans_kind_goal',
  evolution: 'ml_orphans_kind_evolution',
};

/** "33 ideas · 2 reviews" (counts in the backend's order, largest first). */
export function kindsLine(c: OrphanCluster, m: M, tx: Tx): string {
  return c.kinds
    .map((k) => {
      const key = KIND_WORD[k.kind];
      return tx(m.ml_orphans_kind_count, { count: k.count, kind: key ? (m[key] as string) : k.kind });
    })
    .join(' · ');
}

/** Why the cluster asks for a mandate, or that it does not yet. */
export function whyLine(c: OrphanCluster, perCard: number, m: M, tx: Tx): string {
  const per = Math.round(perCard * 10) / 10;
  if (c.why === 'large') return tx(m.ml_orphans_why_large, { count: c.items, per });
  if (c.why === 'growing') return tx(m.ml_orphans_why_growing, { recent: c.recent, count: c.items });
  return tx(m.ml_orphans_why_quiet, { count: c.items, per });
}

/** One mandate per project to adopt into: the active one routing it, else the newest. */
export function adoptTargets(mandates: readonly MandateSummary[] | null, project: string): MandateSummary[] {
  const byProject = new Map<string, MandateSummary>();
  for (const s of mandates ?? []) {
    if (s.projectId === project) continue;
    const prev = byProject.get(s.projectId);
    if (!prev || (prev.status !== 'active' && s.status === 'active')) byProject.set(s.projectId, s);
  }
  return [...byProject.values()].sort((a, b) => (a.projectName ?? '').localeCompare(b.projectName ?? ''));
}

/** The personas stewarding a mandate, once each: who a draft may name. */
export function stewardChoices(mandates: readonly MandateSummary[] | null): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const s of mandates ?? []) {
    if (!seen.has(s.stewardPersonaId)) seen.set(s.stewardPersonaId, s.stewardName ?? s.stewardPersonaId);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
