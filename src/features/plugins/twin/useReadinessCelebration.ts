import { useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useTwinReadiness } from './useTwinReadiness';

/**
 * Disarm window after a twin switch. The per-layer fetches (tones / channels /
 * voice / memories) land asynchronously, so a freshly-activated twin's score
 * ramps from 0 up to its real value over a beat — that ramp is NOT user
 * progress and must not fire a celebration. 2.5s comfortably covers the
 * hydration burst kicked off by useHydrateActiveTwin.
 */
const HYDRATION_WINDOW_MS = 2500;

/**
 * Fires a one-shot success toast when the active twin's readiness score climbs
 * — i.e. the user just closed a milestone. Mount once (TwinPage) so the cue is
 * consistent regardless of which sub-tab is open. Disarmed during the hydration
 * window above; re-disarms on every twin switch.
 */
export function useReadinessCelebration() {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin.progress;
  const addToast = useToastStore((s) => s.addToast);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const readiness = useTwinReadiness();

  const prevScoreRef = useRef<number | null>(null);
  const armedRef = useRef(false);

  // Re-arm on twin switch: drop the baseline and stay quiet until hydration settles.
  useEffect(() => {
    armedRef.current = false;
    prevScoreRef.current = null;
    if (!activeTwinId) return;
    const id = window.setTimeout(() => {
      armedRef.current = true;
    }, HYDRATION_WINDOW_MS);
    return () => window.clearTimeout(id);
  }, [activeTwinId]);

  useEffect(() => {
    const score = readiness.score;
    const prev = prevScoreRef.current;
    prevScoreRef.current = score;
    // Track the baseline silently while disarmed (the hydration ramp); only an
    // increase observed *after* arming is a genuine milestone close.
    if (!armedRef.current || prev == null) return;
    if (score > prev) {
      addToast(score >= 100 ? t.celebrateComplete : tx(t.celebrateProgress, { pct: score }), 'success');
    }
  }, [readiness.score, addToast, t, tx]);
}
