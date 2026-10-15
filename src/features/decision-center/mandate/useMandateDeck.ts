/**
 * useMandateDeck — what a lane deck needs from the mandates: the draft
 * mandates as Sign cards, the mandates by charter id (the Breach and claim
 * cards read their envelope), the snapshot's per-charter counts (the Sign
 * card's forecast), and the one write path for mandate verdicts.
 *
 * Reads `mandate_list` only while a lane deck is open. A signed or dropped
 * draft leaves the deck at once (optimistic) and comes back if the write did
 * not land; every landed write re-reads the mandates and the lanes snapshot,
 * because a drop writes no act and so raises no `charter-act-recorded`.
 */
import { useCallback, useMemo, useState } from 'react';

import { retirePersonaResponsibility } from '@/api/agents/responsibilities';
import { amendMandate, signMandate, suspendMandate } from '@/api/mandates';
import { useMandates } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandates';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import type { LaneCharter } from '@/lib/bindings/LaneCharter';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';

import type { DeckVerdict } from '../deck/deckTypes';
import { refreshLanesSnapshot } from '../lanes/lanesSnapshotSource';
import type { DecisionItem } from '../model/decisionModel';
import { mandateToDecision } from './mandateItem';
import { writeMandateVerdict, type MandateDoors } from './mandateWrites';

const DOORS: MandateDoors = {
  sign: signMandate,
  drop: retirePersonaResponsibility,
  amend: amendMandate,
  suspend: suspendMandate,
};

export interface MandateDeck {
  items: DecisionItem[];
  mandates: ReadonlyMap<string, MandateSummary>;
  charters: ReadonlyMap<string, LaneCharter>;
  /** Resolves true when it wrote (the caller skips the roster); rejects when the write did not land. */
  write: (v: DeckVerdict) => Promise<boolean>;
}

export function useMandateDeck(enabled: boolean, snapshot: DecisionLanesSnapshot | null): MandateDeck {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { mandates, refresh } = useMandates(enabled);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());

  const byId = useMemo(() => new Map((mandates ?? []).map((s) => [s.charterId, s])), [mandates]);
  const charters = useMemo(() => new Map((snapshot?.charters ?? []).map((c) => [c.charterId, c])), [snapshot]);
  const items = useMemo(
    () => (mandates ?? [])
      .filter((s) => s.status === 'draft' && !gone.has(s.charterId))
      .map((s) => mandateToDecision(s, m, tx, m.triage_skip)),
    [mandates, gone, m, tx],
  );

  const write = useCallback(async (v: DeckVerdict): Promise<boolean> => {
    const leaves = v.item.kind === 'mandate' && (v.verdict === 'accept' || v.verdict === 'reject');
    const id = v.item.sourceId;
    if (leaves) setGone((g) => new Set(g).add(id));
    try {
      const wrote = await writeMandateVerdict(v, DOORS);
      if (wrote) {
        refresh();
        void refreshLanesSnapshot();
      }
      return wrote;
    } catch (err) {
      if (leaves) setGone((g) => { const n = new Set(g); n.delete(id); return n; });
      throw err;
    }
  }, [refresh]);

  return { items, mandates: byId, charters, write };
}
