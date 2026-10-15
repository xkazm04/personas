/**
 * useMandateDeck — what a lane deck needs from the mandates: the draft
 * mandates and the re-reads (signed mandates whose use asks to be read again,
 * `MandateSummary.reread`) as Sign cards, the mandates by charter id (the Breach and claim
 * cards read their envelope), the snapshot's per-charter counts (the Sign
 * card's forecast), and the one write path for mandate verdicts.
 *
 * Reads `mandate_list` only while a lane deck is open. A signed or dropped
 * draft leaves the deck at once (optimistic) and comes back if the write did
 * not land; every landed write re-reads the mandates and the lanes snapshot
 * at once rather than wait for the `charter-act-recorded` push.
 *
 * A verdict on a MIRRORED mandate (WP9: it lives on its home device) is sent
 * home; when the home is offline the door answers `network_offline` and the
 * verdict waits in the outbox. That is the drawer's "Queued until <device>
 * wakes" (`useMandateDoors`), not a failure: the write resolves `queuedOn`
 * the home's name, the card stays out of this deck, and the deck says it is
 * queued instead of toasting an error (residue item 6).
 */
import { useCallback, useMemo, useState } from 'react';

import { amendMandate, dropMandate, keepMandate, signMandate, suspendMandate } from '@/api/mandates';
import { useMandates } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandates';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import type { LaneCharter } from '@/lib/bindings/LaneCharter';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { isTauriError } from '@/lib/types/tauriError';

import type { DeckVerdict } from '../deck/deckTypes';
import { refreshLanesSnapshot } from '../lanes/lanesSnapshotSource';
import type { DecisionItem } from '../model/decisionModel';
import { mandateToDecision } from './mandateItem';
import { rereadToDecision } from './rereadItem';
import { writeMandateVerdict, type MandateDoors } from './mandateWrites';

const DOORS: MandateDoors = {
  sign: signMandate,
  drop: dropMandate,
  keep: keepMandate,
  amend: amendMandate,
  suspend: suspendMandate,
};

export interface MandateDeck {
  items: DecisionItem[];
  mandates: ReadonlyMap<string, MandateSummary>;
  charters: ReadonlyMap<string, LaneCharter>;
  /** Resolves when it wrote, or queued it for the mandate's home device; rejects when the write did not land. */
  write: (v: DeckVerdict) => Promise<MandateWritten>;
}

export interface MandateWritten {
  /** It was a mandate write (the caller skips the roster). */
  wrote: boolean;
  /** Sent home and waiting there: the home device's name. */
  queuedOn?: string;
}

/** The mandate a verdict writes to. */
function charterOf(v: DeckVerdict): string {
  return v.mandateAct?.charterId ?? v.item.payload?.charterId ?? v.item.sourceId;
}

export function useMandateDeck(enabled: boolean, snapshot: DecisionLanesSnapshot | null): MandateDeck {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { mandates, refresh } = useMandates(enabled);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());

  const byId = useMemo(() => new Map((mandates ?? []).map((s) => [s.charterId, s])), [mandates]);
  const charters = useMemo(() => new Map((snapshot?.charters ?? []).map((c) => [c.charterId, c])), [snapshot]);
  const items = useMemo(() => {
    const out: DecisionItem[] = [];
    for (const s of mandates ?? []) {
      if (s.status === 'draft') out.push(mandateToDecision(s, m, tx, m.triage_skip, charters.get(s.charterId)?.held));
      else if (s.reread) out.push(rereadToDecision(s, s.reread, m, tx, m.triage_skip));
    }
    return out.filter((i) => !gone.has(i.id));
  }, [mandates, gone, charters, m, tx]);

  const write = useCallback(async (v: DeckVerdict): Promise<MandateWritten> => {
    const leaves = v.item.kind === 'mandate' && (v.verdict === 'accept' || v.verdict === 'reject');
    const id = v.item.id;
    if (leaves) setGone((g) => new Set(g).add(id));
    try {
      const wrote = await writeMandateVerdict(v, DOORS);
      if (wrote) {
        refresh();
        void refreshLanesSnapshot();
      }
      return { wrote };
    } catch (err) {
      // Same reading as the drawer's doors: on a mirrored mandate, offline
      // means sent home and waiting there. The card stays out of this deck.
      const home = byId.get(charterOf(v))?.mirror?.homeName;
      if (home && isTauriError(err) && err.kind === 'network_offline') return { wrote: true, queuedOn: home };
      if (leaves) setGone((g) => { const n = new Set(g); n.delete(id); return n; });
      throw err;
    }
  }, [refresh, byId]);

  return { items, mandates: byId, charters, write };
}
