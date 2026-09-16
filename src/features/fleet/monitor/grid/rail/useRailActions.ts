// useRailActions — what a rail row can DO, and the two surfaces behind it.
//
// The triage surface is held as the SOURCE OBJECT rather than as a row id: a
// row id resolved on every render would re-resolve against a list that polls
// underneath the open modal, and the card would swap out from under the reader
// mid-decision. Captured once on open, it cannot.
//
// A message THREAD is the opposite case and is held by KEY, with the thread
// captured on open only as a fallback: a conversation is supposed to move
// while it is open (your reply lands in it, the persona answers), so the
// caller re-resolves the key against the live threads on every render.
//
// The verdicts take a row ID rather than an item, so `RailRowView` never has to
// hold a `TriageItem` — it holds a projection, and the resolution stays on this
// side of the boundary. That is the same reason `RailRow` has no back-pointer.

import { useCallback, useState } from 'react';
import type { TriageItem, TriageVerdict } from '@/features/agents/quick-answer/triage/triageTypes';
import { toastCatch } from '@/lib/silentCatch';
import type { TaggedItem } from '../../channels/types';
import type { MessageThread } from './messageThreads';
import type { RailRow } from './railModel';
import type { RowResolver } from './useRailFeeds';
import type { RailTab } from './RailChrome';

export interface RailActions {
  openTriage: TriageItem | null;
  /** The open thread as captured on open; resolve `.key` live for updates. */
  openThread: MessageThread | null;
  closeTriage: () => void;
  closeThread: () => void;
  openRow: (row: RailRow) => void;
  acceptRow: (id: string) => void;
  rejectRow: (id: string) => void;
  drillToSpeaker: (tagged: TaggedItem) => void;
}

export function useRailActions({
  tab, reviewById, threadByKey, decide, onOpenSpeaker,
}: {
  tab: RailTab;
  reviewById: RowResolver<TriageItem>;
  threadByKey: RowResolver<MessageThread>;
  decide: (item: TriageItem, verdict: TriageVerdict) => Promise<void>;
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
}): RailActions {
  const [openTriage, setOpenTriage] = useState<TriageItem | null>(null);
  const [openThread, setOpenThread] = useState<MessageThread | null>(null);
  const closeTriage = useCallback(() => setOpenTriage(null), []);
  const closeThread = useCallback(() => setOpenThread(null), []);

  const openRow = useCallback(
    (row: RailRow) => {
      if (tab === 'reviews') {
        const item = reviewById(row.id);
        if (item) setOpenTriage(item);
        return;
      }
      if (tab === 'messages') {
        const thread = threadByKey(row.id);
        if (thread) setOpenThread(thread);
      }
    },
    [tab, reviewById, threadByKey],
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
      setOpenThread(null);
      const speaker = tagged.item.personaId ?? tagged.team.members[0]?.personaId;
      if (speaker && onOpenSpeaker) onOpenSpeaker(tagged.team.teamId, speaker);
    },
    [onOpenSpeaker],
  );

  return {
    openTriage, openThread, closeTriage, closeThread,
    openRow, acceptRow, rejectRow, drillToSpeaker,
  };
}
