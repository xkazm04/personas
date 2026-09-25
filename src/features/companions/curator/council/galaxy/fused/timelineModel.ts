// What each rung of the altitude timeline prints. The current rung carries
// the figures the soundings below do not; under council focus the sky holds
// the lit set, so it says that instead of the sky's totals.
import type { EnginePath } from '../engine/GalaxyEngine';
import type { GalaxyCounts, GalaxyLayout } from '../engine/types';
import { depthBelow, focusNode, levelOf, nodeTitle, soundWidth } from './fusedModel';
import type { FusedStrings } from './fusedStrings';
import type { RungFigure } from './TimelineRung';
import type { FusedData } from './useFused';

export function currentFigures(
  s: FusedStrings,
  path: EnginePath,
  data: FusedData,
  counts: GalaxyCounts,
  council: { missing: number } | null,
): RungFigure[] {
  const f = s.f;
  if (council) {
    const out: RungFigure[] = [
      { key: 'lit', value: counts.lit, label: f.fig_lit, lit: true },
      { key: 'dimmed', value: counts.dimmed, label: f.fig_dimmed },
    ];
    if (council.missing) out.push({ key: 'missing', value: council.missing, label: f.fig_missing });
    return out;
  }
  const law = (n: number | null) => s.plural(n ?? 0, f.fig_law_one, f.fig_law_other);
  if (path.technique) {
    const t = path.technique;
    return [
      { key: 'laws', value: t.laws.length, label: law(t.laws.length) },
      { key: 'triggers', value: t.useWhen.length, label: s.plural(t.useWhen.length, f.fig_trigger_one, f.fig_trigger_other) },
    ];
  }
  if (path.subject) {
    const sub = path.subject;
    return [
      { key: 'laws', value: sub.lawCount, label: law(sub.lawCount) },
      { key: 'applications', value: sub.applications, label: f.fig_applications },
      { key: 'revision', value: data.revisions.get(sub.slug) ?? null, label: f.fig_revision },
    ];
  }
  if (path.category) {
    const c = path.category;
    const subcats = c.wedges.filter((w) => w.key !== '').length;
    const apps = c.subjects.reduce((n, x) => n + x.applications, 0);
    return [
      { key: 'subcategories', value: subcats, label: s.plural(subcats, f.fig_subcategory_one, f.fig_subcategory_other) },
      { key: 'applications', value: apps, label: f.fig_applications },
    ];
  }
  if (path.domain) {
    const d = path.domain;
    const apps = d.categories.reduce((n, c) => n + c.subjects.reduce((m, x) => m + x.applications, 0), 0);
    return [
      { key: 'laws', value: d.lawCount, label: law(d.lawCount) },
      { key: 'applications', value: apps, label: f.fig_applications },
    ];
  }
  return [
    { key: 'laws', value: data.lawCount, label: law(data.lawCount) },
    { key: 'applications', value: data.applications, label: f.fig_applications },
  ];
}

export interface RungSpec {
  index: number;
  state: 'reached' | 'current' | 'below';
  tag: string;
  name: string;
  sounding?: { value: number | null; width: number; next: boolean; label: string };
}

const UNIT_TAGS = ['sky', 'domain', 'category', 'subject', 'technique'] as const;

/** The five rungs, top to bottom, for where the reader stands. */
export function rungsFor(s: FusedStrings, layout: GalaxyLayout, path: EnginePath, councilTitle: string | null): RungSpec[] {
  const lvl = levelOf(path);
  const nodes = [null, path.domain, path.category, path.subject, path.technique];
  const depth = depthBelow(layout, focusNode(path));
  const total = layout.subjects.reduce((n, x) => n + x.techniques.length, 0);
  return UNIT_TAGS.map((kind, i) => {
    const node = nodes[i] ?? null;
    const tag = s.tag(kind);
    const name = i === 0 ? (councilTitle ?? s.f.every_domain) : node ? nodeTitle(node) : '';
    if (i < lvl) return { index: i, state: 'reached', tag, name };
    if (i === lvl) {
      let t = tag;
      if (node && node.kind !== 'technique' && node.kind !== 'domain') t = s.kindIndex(node.kind, node.rank, node.kind === 'category' ? node.domain.categories.length : node.category.subjects.length);
      else if (node?.kind === 'domain') t = s.kindIndex('domain', node.rank, layout.domains.length);
      else if (node?.kind === 'technique') t = s.kindIndex('technique', node.rank, node.subject.techniques.length);
      if (i === 0 && councilTitle) t = s.f.tag_council;
      return { index: i, state: 'current', tag: t, name };
    }
    const v = depth[i] ?? null;
    return {
      index: i,
      state: 'below',
      tag,
      name: '',
      sounding: { value: v, width: v == null ? 0 : soundWidth(v, total), next: i === lvl + 1, label: v == null ? s.f.not_measured : s.f.sound_label.replace('{count}', s.n(v)) },
    };
  });
}
