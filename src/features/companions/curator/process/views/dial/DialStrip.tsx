import { useMemo } from 'react';
import type { TimelineStep } from './dialDetail';

const PHASES = ['brief', 'explore', 'edit', 'verify', 'ship'];
const PHASE_CLASS: Record<string, string> = { brief: 'p-brief', explore: 'p-explore', edit: 'p-edit', verify: 'p-verify', ship: 'p-ship' };

/**
 * One session's step sequence: a single SVG with one <path> per colour, however many steps it has.
 * A step is a slice of the width; a tool error is the rose foot of its slice; an interrupt or a
 * compaction is a full amber slice. Idle waits are left out, so width is steps, not clock time.
 */
export function DialStrip({ steps, large }: { steps: TimelineStep[]; large?: boolean }) {
  const paths = useMemo(() => {
    const shown = steps.filter((s) => s.kind !== 'wait' && s.kind !== 'notify');
    const W = 1000;
    const w = W / Math.max(1, shown.length);
    const by: Record<string, string> = {};
    const add = (cls: string, x: number, y: number, ww: number, hh: number) => {
      const wd = Math.max(ww, 1.2).toFixed(1);
      by[cls] = `${by[cls] ?? ''}M${x.toFixed(1)} ${y}h${wd}v${hh}h-${wd}z`;
    };
    shown.forEach((s, i) => {
      const x = i * w;
      if (s.friction) { add('p-fric', x, 0, w, 24); return; }
      add(PHASE_CLASS[PHASES.includes(s.phase) ? s.phase : 'explore']!, x, 0, w - 0.4, s.err > 0 ? 17 : 24);
      if (s.err > 0) add('p-err', x, 19, w - 0.4, 5);
    });
    return Object.entries(by);
  }, [steps]);
  return (
    <svg className={`dial-strip${large ? ' dial-strip-lg' : ''}`} viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {paths.map(([cls, d]) => <path key={cls} className={cls} d={d} />)}
    </svg>
  );
}
