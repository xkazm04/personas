import { useEffect } from 'react';
import { getRadioState, radioPause } from '@/api/radio';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Turning radio OFF unmounts `RadioFooter`, which owns both playback engines,
 * so the audio stops. The backend does not know that: it would keep
 * `status = 'playing'` and Settings / the media session would report music
 * over silence. While the radio is disabled, make the backend say so.
 *
 * Mounted by `DesktopFooter` (always on screen) because the component that owns
 * the engines is exactly the one that is gone when this matters.
 */
export function useSilenceRadioWhenDisabled(radioEnabled: boolean): void {
  useEffect(() => {
    if (radioEnabled) return;
    let cancelled = false;
    getRadioState()
      .then((state) => {
        if (cancelled) return;
        if (state.status === 'playing' || state.status === 'buffering') {
          return radioPause();
        }
      })
      .catch(silentCatch('radio:silence-when-disabled'));
    return () => {
      cancelled = true;
    };
  }, [radioEnabled]);
}
