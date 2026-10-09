// PROTOTYPE ROUND (spark council-readout). The reader's place in the new
// queue and the latest-round cache the rows draw their members from.
//
// The list projection carries no per-member scores, so each listed row's
// latest round is read ONCE here and kept by run id (<= 45 small reads on
// the live store). Consolidation replaces this cache with a `dimensions`
// field on the Rust projection.
import { create } from 'zustand';

import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import { silentCatch } from '@/lib/silentCatch';

import { readRound } from '../table/useCouncilRun';
import type { QueueFilter } from './protoModel';

/** Rounds read at once; the rest queue behind them. */
const BATCH = 6;

interface ProtoStore {
  /** The row the header CTA acts on. */
  selectedId: string | null;
  /** The council open full page. Null = the galaxy. */
  openId: string | null;
  filter: QueueFilter;
  /** Latest rounds by run id. A failed read is `READ_FAILED`, never an empty round. */
  details: Record<string, CouncilRunDetail | typeof READ_FAILED>;
  select: (id: string | null) => void;
  open: (id: string | null) => void;
  setFilter: (filter: QueueFilter) => void;
  loadDetails: (runIds: string[]) => Promise<void>;
}

const inflight = new Set<string>();

/** A round that could not be read - kept apart from a round that found nothing. */
export const READ_FAILED = 'read-failed' as const;

export const useProtoStore = create<ProtoStore>((set, get) => ({
  selectedId: null,
  openId: null,
  filter: 'waiting',
  details: {},
  select: (selectedId) => set({ selectedId }),
  open: (openId) => set({ openId }),
  setFilter: (filter) => set({ filter }),
  loadDetails: async (runIds) => {
    const todo = runIds.filter((id) => !(id in get().details) && !inflight.has(id));
    todo.forEach((id) => inflight.add(id));
    // BATCH workers pull from one queue: the width is chosen here, not by
    // how many councils the list happens to hold.
    const worker = async () => {
      for (let id = todo.shift(); id !== undefined; id = todo.shift()) {
        const runId = id;
        let value: CouncilRunDetail | typeof READ_FAILED;
        try {
          value = await readRound(runId);
        } catch (e: unknown) {
          silentCatch('council:proto-details')(e);
          value = READ_FAILED;
        }
        inflight.delete(runId);
        set((s) => ({ details: { ...s.details, [runId]: value } }));
      }
    };
    await Promise.all([...Array(BATCH).keys()].map(() => worker()));
  },
}));
