// The cold-load ghost for the field.
//
// A calm geometry-matched placeholder UNDER the permanent chrome, not a
// spinner and not a replacement for it: the rail, the breadcrumb and the
// counts stay on screen while the corpus is read. Deliberately delayed, so a
// warm remount (the module cache usually wins) never flashes it.
import { useEffect, useState } from 'react';

const DELAY_MS = 180;

/** Four discs at the sizes the real clusters sit at, so nothing jumps. */
const DISCS = [
  { cx: '38%', cy: '58%', r: 150 },
  { cx: '62%', cy: '36%', r: 96 },
  { cx: '72%', cy: '64%', r: 70 },
  { cx: '48%', cy: '26%', r: 54 },
];

export function GalaxyGhost() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 transition-opacity duration-500"
      aria-hidden="true"
      data-testid="council-galaxy-ghost"
    >
      <svg className="h-full w-full" preserveAspectRatio="none">
        {DISCS.map((d) => (
          <circle
            key={`${d.cx}-${d.cy}`}
            cx={d.cx}
            cy={d.cy}
            r={d.r}
            fill="none"
            stroke="var(--card-border)"
            strokeWidth={1}
          />
        ))}
      </svg>
    </div>
  );
}
