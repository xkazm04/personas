/**
 * The style studio, held by the stage for the whole sitting so it keeps
 * drafting while the person keeps answering: a starting voice chosen while
 * naming the twin takes half a minute or more per channel, and nobody should
 * wait on it. The drafts land here; the person reviews them when they choose
 * to, and the rail wears a mark while something is waiting.
 *
 * The create act RECORDED the start (`setPendingStyleStart`); this is the one
 * place that takes it. `take` deletes, so a remount — or StrictMode's double
 * effect — cannot run the same roll twice.
 */

import { useEffect, useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import { takePendingStyleStart } from '../../setup/style/pendingStyleStart';
import { useStyleStudio } from '../../setup/style/useStyleStudio';
import type { StyleStudioApi } from '../../setup/style/styleContract';

export interface VoiceDock {
  studio: StyleStudioApi;
  /** This twin's stored tone rows, for the current-versus-draft comparison. */
  currentTones: TwinTone[];
  /** True while drafts are waiting to be reviewed — the rail shows a mark. */
  waiting: boolean;
}

export function useVoiceDock(twinId: string | null, channels: string[]): VoiceDock {
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
    run.catch(silentCatch('features/plugins/twin/experience/layers/useVoiceDock:pendingStart'));
  }, [twinId, pickPreset, roll]);

  return {
    studio,
    currentTones,
    waiting: studio.phase === 'preview' || studio.phase === 'candidates',
  };
}
