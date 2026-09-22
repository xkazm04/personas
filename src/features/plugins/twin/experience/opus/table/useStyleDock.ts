/**
 * The style studio, held by the table for the whole sitting so it keeps
 * working while the person keeps answering: a starting style chosen at
 * creation takes 30 seconds or more to draft per channel, and nobody should
 * wait on a spinner for it. The drafts land in the dock; the person reviews
 * them when they choose to.
 *
 * The create phase RECORDED the start (`setPendingStyleStart`); this is the one
 * place that takes it. `take` deletes, so a remount — or StrictMode's double
 * effect — cannot run the same roll twice.
 */

import { useEffect, useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import { takePendingStyleStart } from '../../../setup/style/pendingStyleStart';
import { useStyleStudio } from '../../../setup/style/useStyleStudio';
import type { StyleStudioApi } from '../../../setup/style/styleContract';

export interface StyleDock {
  studio: StyleStudioApi;
  /** This twin's stored tone rows, for the current-versus-draft preview. */
  currentTones: TwinTone[];
}

export function useStyleDock(twinId: string | null, channels: string[]): StyleDock {
  const studio = useStyleStudio(twinId, channels);
  const twinTones = useSystemStore((s) => s.twinTones);
  const currentTones = useMemo(
    () => (twinId ? twinTones.filter((tone) => tone.twin_id === twinId) : []),
    [twinId, twinTones],
  );

  const { pickPreset, roll } = studio;
  useEffect(() => {
    if (!twinId) return;
    const start = takePendingStyleStart(twinId);
    if (!start) return;
    const run = start.kind === 'preset' ? pickPreset(start.presetId) : roll();
    run.catch(silentCatch('features/plugins/twin/experience/table/useStyleDock:pendingStart'));
  }, [twinId, pickPreset, roll]);

  return { studio, currentTones };
}
