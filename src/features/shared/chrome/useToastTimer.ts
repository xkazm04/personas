import { useState, useEffect, useCallback, useRef } from 'react';
import type { BaseToast } from '@/stores/toastStore';
import { formatElapsed } from '@/lib/utils/formatters';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';

/**
 * Shared timer/pause logic for toast items (standard + healing).
 *
 * Drives:
 * - a single RAF loop that accounts for elapsed active (non-paused) time and
 *   fires `onDismiss` once `toast.duration` is exhausted
 * - a once-per-second `elapsedLabel` update ("3s", "1m 04s", ...)
 * - pause-on-hover, with a pause also implied by the tab being backgrounded
 *   (`useDocumentVisibility`) so timers don't silently burn through their
 *   duration while the window isn't visible
 *
 * The progress bar itself stays CSS-driven (`animate-toast-progress` +
 * `data-paused`) for smooth pause/resume — this hook only owns the dismiss
 * timing and the label text.
 */
export function useToastTimer(
  toast: Pick<BaseToast, 'id' | 'duration' | 'timestamp'>,
  onDismiss: (id: string) => void,
) {
  const [paused, setPaused] = useState(false);
  const isDocumentVisible = useDocumentVisibility();
  const [elapsedLabel, setElapsedLabel] = useState('');
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const pausedRef = useRef(false);
  const isPaused = paused || !isDocumentVisible;
  pausedRef.current = isPaused;

  // Single RAF loop handles both dismiss countdown and elapsed label.
  // The progress bar is driven by CSS animation (smooth pause/resume); this
  // loop only fires the dismiss callback once duration is exhausted.
  useEffect(() => {
    let rafId: number;
    let lastLabelSec = -1;
    lastTickRef.current = Date.now();

    const tick = () => {
      const now = Date.now();
      if (!pausedRef.current) {
        elapsedRef.current += now - lastTickRef.current;
        if (elapsedRef.current >= toast.duration) {
          onDismiss(toast.id);
          return;
        }
      }
      lastTickRef.current = now;

      const sec = Math.floor((now - toast.timestamp) / 1000);
      if (sec !== lastLabelSec) {
        lastLabelSec = sec;
        setElapsedLabel(formatElapsed(now - toast.timestamp));
      }

      rafId = requestAnimationFrame(tick);
    };

    setElapsedLabel(formatElapsed(Date.now() - toast.timestamp));
    if (!isDocumentVisible) return;
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [toast.duration, toast.id, toast.timestamp, onDismiss, isDocumentVisible]);

  const onMouseEnter = useCallback(() => setPaused(true), []);
  const onMouseLeave = useCallback(() => {
    // Drift correction: resuming after a hover pause must not count the
    // paused interval as elapsed time, so re-anchor the tick clock to "now".
    lastTickRef.current = Date.now();
    setPaused(false);
  }, []);

  return { elapsedLabel, isPaused, onMouseEnter, onMouseLeave };
}
