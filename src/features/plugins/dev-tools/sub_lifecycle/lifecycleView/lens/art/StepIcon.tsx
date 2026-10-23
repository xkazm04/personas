/**
 * A drawn line icon per practice step, on a 24-unit grid (from the Lens
 * winner's `art.js`). Stylised marks: they name a step, they never carry a
 * verdict, so they draw in `currentColor` and their caller inks them.
 * A custom step draws a plain ring.
 */
import { memo } from 'react';

const PATHS: Record<string, string> = {
  frame: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M14.2 12a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0',
  recall: 'M3.5 6.5c3-1.6 5.8-1.6 8.5 0v13c-2.7-1.6-5.5-1.6-8.5 0zM20.5 6.5c-3-1.6-5.8-1.6-8.5 0v13c2.7-1.6 5.5-1.6 8.5 0z',
  isolate: 'M7 3v18M7 8.5c0 4.5 10 2.8 10 8.5V21M19 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0M17 7v1.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sync: 'M19 8.5A7.5 7.5 0 0 0 6.2 6.6M5 3.5V7h3.5M5 15.5a7.5 7.5 0 0 0 12.8 1.9M19 20.5V17h-3.5',
  gate: 'M4 21V10a8 8 0 0 1 16 0v11M3 21h18M8.5 21v-9.5M12 21V8.5M15.5 21v-9.5M5 14h14',
  tests: 'M9 3h6M10 3v6.2L4.8 18.3A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.7L14 9.2V3M7.2 15h9.6',
  docs: 'M6 3h8.5L19 7.5V21H6zM14 3v5h5M9 12.5h7M9 16.5h5',
  commit: 'M2.5 12H8.5M15.5 12h6M15.4 12a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0',
  land: 'M12 3v11.5M7.2 10L12 14.8 16.8 10M4 20h16',
  record: 'M4.5 19.5h4.2L20 8.2 15.8 4 4.5 15.3zM13.6 6.2l4.2 4.2',
};
const RING = 'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0';

export const StepIcon = memo(function StepIcon({ stepId, className, strokeWidth = 1.6 }: {
  stepId: string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[stepId] ?? RING} />
    </svg>
  );
});
