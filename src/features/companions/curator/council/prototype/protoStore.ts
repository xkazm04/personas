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
  /** Latest rounds by run id. A failed read is recorded as `null`. */
  details: Record<string, CouncilRunDetail | null>;
  select: (id: string | null) => void;
  open: (id: string | null) => void;
  setFilter: (filter: QueueFilter) => void;
  loadDetails: (runIds: string[]) => Promise<void>;
}

const inflight = new Set<string>();

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
    for (let i = 0; i < todo.length; i += BATCH) {
      const slice = todo.slice(i, i + BATCH);
      slice.forEach((id) => inflight.add(id));
      const read = await Promise.all(
        slice.map((id) =>
          readRound(id).catch((e: unknown) => {
            silentCatch('council:proto-details')(e);
            return null;
          }),
        ),
      );
      slice.forEach((id) => inflight.delete(id));
      set((s) => {
        const details = { ...s.details };
        slice.forEach((id, k) => {
          details[id] = read[k] ?? null;
        });
        return { details };
      });
    }
  },
}));
