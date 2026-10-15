/**
 * usePeekSignItems — the mandates the Sign lane's peek lists: the drafts and
 * the re-reads.
 *
 * The roster carries no mandates: a draft charter reaches the lanes only as a
 * snapshot entry `mandate:<charterId>`, a signed one whose use asks to be read
 * again as `mandate-reread:<charterId>`, and the deck builds both cards from
 * `mandate_list` (`useMandateDeck`). The peek does the same here, so the lane
 * count and the rows agree: one row per draft and per re-read, with the same
 * id the deck focuses on. A draft is titled so the row reads as what it asks
 * ("Sign the Personas mandate: Codebase security scan"); a re-read keeps its
 * card's title, which is already the reason it asks, project included.
 *
 * Reads `mandate_list` only while the Sign peek is open. `ready` is false
 * until the first read lands; a failed read is `failed`, never an empty lane.
 */
import { useMemo } from 'react';

import { useMandates } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandates';
import { useTranslation } from '@/i18n/useTranslation';

import { mandateToDecision } from '../../mandate/mandateItem';
import { rereadToDecision } from '../../mandate/rereadItem';
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
    const out: DecisionItem[] = [];
    for (const s of mandates) {
      if (s.status === 'draft') {
        const item = mandateToDecision(s, m, tx, m.triage_skip);
        const project = s.projectName ?? m.ml_project_unknown;
        out.push({ ...item, title: tx(m.ml_peek_sign_title, { project, title: s.title }) });
      } else if (s.reread) {
        out.push(rereadToDecision(s, s.reread, m, tx, m.triage_skip));
      }
    }
    return out;
  }, [enabled, mandates, m, tx]);
  return { items, ready: !enabled || mandates !== null || failed, failed: enabled && failed && mandates === null };
}
