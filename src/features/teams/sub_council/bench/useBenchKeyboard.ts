// The bench's keys, through the app's one key handler.
//
// Nothing here commits anything. `G` moves the focus to Approve and stops;
// the arm-then-confirm and the reason gate live in the gate component, which
// is the component that owns the mutation.
//
// The priority sits ABOVE the galaxy's route-decision handler so that while
// the bench is up, Escape climbs the bench first and only reaches the field
// once the bench is down. That is the reference's ladder: table -> queue ->
// sky, with the sky's exact camera restored at the last step.
import { useCallback, useState } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import { useCouncilStore } from '../councilStore';

export function useBenchKeyboard({
  flat,
  open,
}: {
  flat: CouncilSubjectState[];
  open: CouncilSubjectState | null;
}) {
  const [seatIndex, setSeatIndex] = useState<number | null>(null);
  const [seatCount, setSeatCount] = useState(5);

  const handler = useCallback(
    (e: KeyboardEvent) => {
      // A reason being typed into the reject box owns every key but Escape.
      if (isTypingTarget(e.target)) return false;
      const s = useCouncilStore.getState();

      if (e.key === 'Escape') {
        if (s.tableSubjectId) {
          s.setTableSubject(null);
          setSeatIndex(null);
          return true;
        }
        // Dropping the bench is the galaxy's cue to restore the camera the
        // reader had before they opened it.
        s.setBenchOpen(false);
        return true;
      }

      if (open) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const step = e.key === 'ArrowRight' ? 1 : -1;
          setSeatIndex((i) => ((i ?? 0) + step + seatCount) % seatCount);
          return true;
        }
        if (/^[1-9]$/.test(e.key)) {
          const i = Number(e.key) - 1;
          if (i < seatCount) setSeatIndex(i);
          return true;
        }
        if (e.key === 'g' || e.key === 'G') {
          s.focusGate();
          return true;
        }
        return false;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(0, Math.min(flat.length - 1, s.queueIndex + step));
        s.setQueueIndex(next);
        return true;
      }
      if (e.key === 'Enter') {
        const row = flat[s.queueIndex];
        if (row) {
          s.setTableSubject(row.id);
          setSeatIndex(null);
          return true;
        }
      }
      return false;
    },
    [flat, open, seatCount],
  );

  useAppKeyboard(handler, { priority: FULLSCREEN_LAYER_PRIORITY });

  return { seatIndex, setSeatIndex, setSeatCount };
}
