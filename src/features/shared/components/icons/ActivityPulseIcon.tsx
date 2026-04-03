import type { SVGProps } from 'react';

/**
 * Activity pulse icon for the process indicator in the header bar.
 * Depicts a heartbeat/signal trace with a radiating dot — conveys
 * "background processes are alive and running."
 *
 * Designed to match Lucide icon conventions:
 * - 24x24 viewBox, stroke-based, no fills
 * - Uses currentColor for theme adaptation
 * - Works at low opacity (idle) and full opacity (active)
 */
export function ActivityPulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* Signal trace — a heartbeat pulse line */}
      <polyline points="2,12 6,12 8,8 10,16 12,10 14,14 16,12 22,12" />
      {/* Radiating arcs — activity emanating from center */}
      <path d="M12 5a7 7 0 0 1 4.9 2" />
      <path d="M12 5a7 7 0 0 0-4.9 2" />
    </svg>
  );
}
