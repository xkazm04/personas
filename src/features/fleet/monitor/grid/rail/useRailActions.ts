// useRailActions — what a rail row can DO, and the two surfaces behind it.
//
// Both open surfaces are held as the SOURCE OBJECT rather than as a row id: a
// row id resolved on every render would re-resolve against a list that polls
// underneath the open modal, and the card would swap out from under the reader
// mid-decision. Captured once on open, it cannot.
//
// The verdicts take a row ID rather than an item, so `RailRowView` never has to
// hold a `TriageItem` — it holds a projection, and the resolution stays on this
// side of the boundary. That is the same reason `RailRow` has no back-pointer.

import { useCallback, useState } from 'react';
import type { TriageItem, TriageVerdict } from '@/features/agents/quick-answer/triage/triageTypes';
import { toastCatch } from '@/lib/silentCatch';
import type { TaggedItem } from '../../channels/types';
import type { RailRow } from './railModel';
import type { RowResolver } from './useRailFeeds';
import type { RailTab } from './RailChrome';

export interface RailActions {
  openTriage: TriageItem | null;
  openMessage: TaggedItem | null;
  closeTriage: () => void;
  closeMessage: () => void;
  openRow: (row: RailRow) => void;
  acceptRow: (id: string) => void;
  rejectRow: (id: string) => void;
  drillToSpeaker: (tagged: TaggedItem) => void;
}

export function useRailActions({
  tab, reviewById, messageById, decide, onOpenSpeaker,
}: {
  tab: RailTab;
  reviewById: RowResolver<TriageItem>;
  messageById: RowResolver<TaggedItem>;
  decide: (item: TriageItem, verdict: TriageVerdict) => Promise<void>;
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
}): RailActions {
  const [openTriage, setOpenTriage] = useState<TriageItem | null>(null);
  const [openMessage, setOpenMessage] = useState<TaggedItem | null>(null);
  const closeTriage = useCallback(() => setOpenTriage(null), []);
  const closeMessage = useCallback(() => setOpenMessage(null), []);

  const openRow = useCallback(
    (row: RailRow) => {
      if (tab === 'reviews') {
        const item = reviewById(row.id);
        if (item) setOpenTriage(item);
        return;
      }
      if (tab === 'messages') {
        const tagged = messageById(row.id);
        if (tagged) setOpenMessage(tagged);
      }
    },
    [tab, reviewById, messageById],
  );

  const decideById = useCallback(
    (id: string, verdict: TriageVerdict) => {
      const item = reviewById(id);
      if (!item) return;
      void decide(item, verdict).catch(toastCatch('activity-rail:decide'));
    },
    [reviewById, decide],
  );
  const acceptRow = useCallback((id: string) => decideById(id, 'accept'), [decideById]);
  const rejectRow = useCallback((id: string) => decideById(id, 'reject'), [decideById]);

  /** Escape hatch from the message modal into the Timeline scoped to its team. */
  const drillToSpeaker = useCallback(
    (tagged: TaggedItem) => {
      setOpenMessage(null);
      const speaker = tagged.item.personaId ?? tagged.team.members[0]?.personaId;
      if (speaker && onOpenSpeaker) onOpenSpeaker(tagged.team.teamId, speaker);
    },
    [onOpenSpeaker],
  );

  return {
    openTriage, openMessage, closeTriage, closeMessage,
    openRow, acceptRow, rejectRow, drillToSpeaker,
  };
}
