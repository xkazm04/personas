import { useMemo } from 'react';

import type { StandupSource } from '../data/types';
import { openAthenaChat } from '../data/openAthenaChat';
import { statePatch } from '../model/patch';
import type { RowView } from '../model/types';
import type { StandupController } from './pageTypes';

/** Every keyboard intent of a row, also as a click path (the keymap owns the keys; these own the mouse). */
export interface RowActions {
  pick: (row: RowView, index: number) => void;
  typed: (row: RowView, text: string | null) => void;
  edit: (row: RowView) => void;
  skip: (row: RowView) => void;
  accept: (row: RowView) => void;
  undo: (row: RowView) => void;
  talk: (row: RowView) => void;
  dossier: () => void;
}

export function useRowActions(c: StandupController, source: StandupSource): RowActions {
  const { pick, typed, set } = c;
  const { patch, discuss } = source.actions;
  return useMemo(() => {
    const send = (p: ReturnType<typeof statePatch>) => { if (p) void patch(p); };
    return {
      pick,
      typed,
      edit: (row) => set({ typing: row.key }),
      skip: (row) => send(statePatch(row, 'skipped')),
      accept: (row) => send(statePatch(row, 'accepted')),
      undo: (row) => send(statePatch(row, 'proposed')),
      talk: (row) => {
        if (!row.itemId) return;
        set({ decide: false });
        void discuss(row.itemId).then((id) => { if (id) openAthenaChat(id); });
      },
      dossier: () => set({ dossier: true, decide: false }),
    };
  }, [pick, typed, set, patch, discuss]);
}
