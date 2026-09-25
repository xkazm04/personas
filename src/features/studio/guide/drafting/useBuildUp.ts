import { useEffect, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

/**
 * How many steps of a drawing are drawn so far: the first at once, then one
 * more every `stepMs`, counted from the moment this drawing (`key`) first
 * appeared, up to `total`. A new key (the sketch replacing the stock page)
 * starts over. With reduced motion, or `stepMs` 0, everything is drawn at once.
 *
 * The setup wait is long (the scaffold takes a minute or more), so a new
 * project's sheet is built up part by part across it rather than in the first
 * two seconds; a question that lands early sits over the sheet while the
 * build-up carries on behind it.
 */
export function useBuildUp(key: string, total: number, stepMs: number): number {
  const { shouldAnimate } = useMotion();
  const instant = !shouldAnimate || stepMs <= 0;
  const [start, setStart] = useState(() => ({ key, at: Date.now() }));
  const [now, setNow] = useState(() => Date.now());
  if (start.key !== key) {
    // A new drawing: its build-up starts now (React's adjust-on-prop pattern).
    const at = Date.now();
    setStart({ key, at });
    setNow(at);
  }
  const drawn = (t: number) => Math.min(total, Math.max(1, Math.floor((t - start.at) / stepMs) + 1));

  useEffect(() => {
    if (instant || drawn(Date.now()) >= total) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (drawn(t) >= total) window.clearInterval(timer);
    }, Math.min(250, stepMs));
    return () => window.clearInterval(timer);
    // `drawn` closes over start/total/stepMs, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, total, stepMs, instant]);

  return instant ? total : drawn(now);
}
