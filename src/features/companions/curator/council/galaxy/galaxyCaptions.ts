// The three captions the canvas paints that are prose rather than data, plus
// the hover card's two lines. They live here so the engine can stay free of
// user-facing strings and every one of them goes through `t.council.galaxy.*`.
import type { Translations } from '@/i18n/en';
import { interpolate as tx } from '@/i18n/useTranslation';

import type { CanvasCaptions } from './engine/paint';
import type { GalaxyNode } from './engine/types';

export function buildCaptions(t: Translations): CanvasCaptions {
  return {
    domainCaption: (d) =>
      tx(t.council.galaxy.domain_caption, { subjects: d.subjectCount, categories: d.categories.length }),
    subjectFooter: (s) => tx(t.council.galaxy.subject_footer, { count: s.techniques.length }),
    wedgeLabel: (key, n) =>
      tx(t.council.galaxy.wedge_caption, {
        name: key === '' ? t.council.galaxy.no_subcategory : key.replace(/-/g, ' '),
        count: n,
      }),
  };
}

export interface HoverCard {
  title: string;
  detail: string;
}

/** The hover card. One line of identity, one of what it holds. */
export function describeNode(t: Translations, node: GalaxyNode): HoverCard {
  const g = t.council.galaxy;
  if (node.kind === 'domain') {
    return {
      title: `${node.rank}. ${node.title}`,
      detail: tx(g.hover_domain, {
        subjects: node.subjectCount,
        categories: node.categories.length,
        laws: node.lawCount,
      }),
    };
  }
  if (node.kind === 'category') {
    return {
      title: `${node.rank}. ${node.title}`,
      detail: tx(g.hover_category, { subjects: node.subjects.length, subcategories: node.wedges.length }),
    };
  }
  if (node.kind === 'subject') {
    const state = node.mark === 'none' ? g.never_councilled : g[`mark_${node.mark}` as const];
    return {
      title: `${node.rank}. ${node.title}`,
      detail: tx(g.hover_subject, {
        category: node.category.title,
        techniques: node.techniques.length,
        state,
      }),
    };
  }
  return {
    title: `${node.rank}. ${node.slug.replace(/-/g, ' ')}`,
    detail: node.useWhen[0] ?? tx(g.hover_technique, { laws: node.laws.length }),
  };
}
