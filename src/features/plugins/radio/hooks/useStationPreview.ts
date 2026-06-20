import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { RadioState } from '@/lib/bindings/RadioState';
import { radioPause, radioPlay, radioSetStation } from '../api/radioApi';

export interface StationPreview {
  /** Station id currently auditioning (playing or buffering), else null. */
  previewingId: string | null;
  /** Station id currently buffering (subset of previewingId), else null. */
  bufferingId: string | null;
  /** Toggle audition for a station: starts it (and the global radio engine),
   *  or pauses if it's already the one playing. */
  preview: (stationId: string) => void;
}

/**
 * "Preview / play" affordance for the Radio management surface. Auditioning
 * a station just drives the *real* global radio backend — `radioSetStation`
 * then `radioPlay` — so the footer's playback engine (HTML5 audio for SomaFM
 * streams, the hidden YouTube IFrame for YouTube mixes) does the actual work.
 * The footer only mounts when `radioEnabled` is on, so the first preview flips
 * the master switch (visibly, via the page's own control).
 *
 * Takes the live `RadioState` (the caller already subscribes via
 * `useRadioState`) rather than subscribing again, to avoid a second
 * `radio:state` listener per page.
 */
export function useStationPreview(state: RadioState | null): StationPreview {
  const radioEnabled = useSystemStore((s) => s.radioEnabled);
  const setRadioEnabled = useSystemStore((s) => s.setRadioEnabled);

  const currentId = state?.currentStationId ?? null;
  const status = state?.status ?? 'stopped';
  const isActive = status === 'playing' || status === 'buffering';
  const previewingId = isActive ? currentId : null;
  const bufferingId = status === 'buffering' ? currentId : null;

  const preview = useCallback(
    (stationId: string) => {
      if (!radioEnabled) setRadioEnabled(true);
      if (currentId === stationId && isActive) {
        radioPause().catch(silentCatch('radio:preview-pause'));
        return;
      }
      radioSetStation(stationId)
        .then(() => radioPlay())
        .catch(silentCatch('radio:preview'));
    },
    [radioEnabled, setRadioEnabled, currentId, isActive],
  );

  return { previewingId, bufferingId, preview };
}
