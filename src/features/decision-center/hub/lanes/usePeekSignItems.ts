/**
 * usePeekSignItems — the draft mandates the Sign lane's peek lists.
 *
 * The roster carries no mandates: a draft charter reaches the lanes only as a
 * snapshot entry `mandate:<charterId>`, and the deck builds its card from
 * `mandate_list` (`useMandateDeck`). The peek does the same here, so the lane
 * count and the rows agree: one row per draft, with the same id the deck
 * focuses on, titled so the row reads as what it asks ("Sign the Personas
 * mandate: Codebase security scan") rather than as a bare charter title.
 *
 * Reads `mandate_list` only while the Sign peek is open. `ready` is false
 * until the first read lands; a failed read is `failed`, never an empty lane.
 */
import { useMemo } from 'react';

import { useMandates } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandates';
import { useTranslation } from '@/i18n/useTranslation';

import { mandateToDecision } from '../../mandate/mandateItem';
import type { DecisionItem } from '../../model/decisionModel';

export interface PeekSignItems {
  items: DecisionItem[];
  ready: boolean;
  failed: boolean;
}

const NONE: DecisionItem[] = [];

export function usePeekSignItems(enabled: boolean): PeekSignItems {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { mandates, failed } = useMandates(enabled);
  const items = useMemo(() => {
    if (!enabled || !mandates) return NONE;
    return mandates
      .filter((s) => s.status === 'draft')
      .map((s) => {
        const item = mandateToDecision(s, m, tx, m.triage_skip);
        const project = s.projectName ?? m.ml_project_unknown;
        return { ...item, title: tx(m.ml_peek_sign_title, { project, title: s.title }) };
      });
  }, [enabled, mandates, m, tx]);
  return { items, ready: !enabled || mandates !== null || failed, failed: enabled && failed && mandates === null };
}
