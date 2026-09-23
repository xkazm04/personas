// Every sentence the fused HUD composes from figures, in one place. The
// words are `t.council.fused.*` in all fourteen locales; this file only
// fills them in, so no instrument builds a sentence of its own and a count
// is formatted the same way on the timeline, the dock and the tooltip.
import { useMemo } from 'react';

import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import type { GalaxyNode } from '../engine/types';
import type { HudMode } from './hudMode';

export function useFusedStrings() {
  const { t, language } = useTranslation();
  return useMemo(() => {
    const f = t.council.fused;
    const n = (v: number) => formatCount(v, { language });
    const tag = (kind: GalaxyNode['kind'] | 'sky') =>
      kind === 'sky' ? f.tag_sky : kind === 'domain' ? f.tag_domain : kind === 'category' ? f.tag_category : kind === 'subject' ? f.tag_subject : f.tag_technique;
    const modeName = (m: HudMode) => (m === 'lens' ? f.mode_lens : m === 'bar' ? f.mode_bar : f.mode_none);
    return {
      f,
      n,
      tag,
      modeName,
      kindIndex: (kind: GalaxyNode['kind'], index: number, count: number) => tx(f.tag_index, { tag: tag(kind), index, count }),
      plural: (count: number, one: string, other: string) => (count === 1 ? one : other),
      tipDomain: (categories: number, subjects: number, techniques: number) =>
        tx(f.tip_domain, { categories: n(categories), subjects: n(subjects), techniques: n(techniques) }),
      tipCategory: (subjects: number, subcategories: number, techniques: number) =>
        tx(f.tip_category, { subjects: n(subjects), subcategories: n(subcategories), techniques: n(techniques) }),
      tipSubject: (techniques: number, laws: number, applications: number, category: string) =>
        tx(f.tip_subject, { techniques: n(techniques), laws: n(laws), applications: n(applications), category }),
      tipTechnique: (laws: number, triggers: number, subject: string) =>
        tx(f.tip_technique, { laws: n(laws), triggers: n(triggers), subject }),
      tipCouncil: (approved: number, rejected: number, pending: number, proven: number, techniques: number) =>
        tx(f.tip_council, { approved, rejected, pending, proven, techniques }),
      tipNever: f.tip_never,
      tipCare: (count: number) => (count === 1 ? f.tip_care_one : tx(f.tip_care_other, { count: n(count) })),
      clickFly: (name: string) => tx(f.tip_fly, { name }),
      clickOpen: (name: string) => tx(f.tip_open, { name }),
    };
  }, [t, language]);
}

export type FusedStrings = ReturnType<typeof useFusedStrings>;
