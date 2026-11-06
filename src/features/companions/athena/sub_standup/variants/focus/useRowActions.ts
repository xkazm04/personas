import { useMemo } from 'react';

import type { StandupSource } from '../../data/types';
import { openAthenaChat } from '../../data/openAthenaChat';
import { nextOpen } from '../../model/keymap';
import { statePatch } from '../../model/patch';
import type { RowView, StandupView } from '../../model/types';
import type { StandupController } from '../types';

export interface RowActions {
  pick: (row: RowView, index: number) => void;
  accept: (row: RowView) => void;
  skip: (row: RowView) => void;
  undo: (row: RowView) => void;
  type: (row: RowView) => void;
  typed: (row: RowView, text: string | null) => void;
  talk: (row: RowView) => void;
  dossier: () => void;
}

/**
 * The pointer paths for every key the controller owns. A click decides the
 * same way a key does, and then moves on to the next open line exactly as
 * the keymap's `nextOpen` would, so mouse and keyboard leave the queue in
 * the same place.
 */
export function useRowActions(view: StandupView, source: StandupSource, c: StandupController): RowActions {
  const { sel } = c.ui;
  return useMemo(() => {
    const advance = () => c.select(nextOpen(view, sel));
    const patch = (row: RowView, state: 'accepted' | 'skipped' | 'proposed') => {
      const p = statePatch(row, state);
      if (p) void source.actions.patch(p);
    };
    return {
      pick: (row, index) => { c.pick(row, index); advance(); },
      accept: (row) => { patch(row, 'accepted'); advance(); },
      skip: (row) => { patch(row, 'skipped'); advance(); },
      undo: (row) => patch(row, 'proposed'),
      type: (row) => c.set({ typing: row.key }),
      typed: (row, text) => { c.typed(row, text); if (text?.trim()) advance(); },
      talk: (row) => {
        if (!row.itemId) return;
        void source.actions.discuss(row.itemId).then((id) => { if (id) openAthenaChat(id); });
      },
      dossier: () => c.set({ dossier: true }),
    };
  }, [view, source, c, sel]);
}
