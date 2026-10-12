/**
 * The peek row's words: the tier's name and what clearing the item costs, in
 * the unit that matters for its type (answers to give, minutes to read, a
 * reply, a backlog effort, or one key). Resolved at render through
 * `t.monitor.dc_hub_*`, so no copy is frozen in a module constant.
 */
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { modalTypeOf, type DecisionItem, type DecisionTier } from '../../model/decisionModel';

const WORDS_PER_MINUTE = 220;

/** Minutes to read the item's document (or body), at least one. */
export function readMinutes(item: DecisionItem): number {
  const text = (item.document?.content ?? item.body ?? '').replace(/<[^>]+>/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export function useRowCopy() {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  return useMemo(() => ({
    tier: (tier: DecisionTier) =>
      tier === 1 ? m.dc_hub_tier_blocking : tier === 2 ? m.dc_hub_tier_decide : m.dc_hub_tier_read,
    cost: (item: DecisionItem): string => {
      if (item.kind === 'question' && item.input) return tx(m.dc_hub_cost_answers, { count: item.input.fields.length });
      const type = modalTypeOf(item.kind);
      if (type === 'report') return tx(m.dc_hub_cost_read, { count: readMinutes(item) });
      if (type === 'chat') return m.dc_hub_cost_reply;
      if (type === 'backlog') {
        const effort = item.facts.find((f) => f.id === 'effort');
        return effort ? tx(m.dc_hub_cost_effort, { effort: String(effort.value) }) : m.dc_hub_cost_triage;
      }
      return m.dc_hub_cost_one_key;
    },
  }), [m, tx]);
}
