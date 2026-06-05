interface TourProgressArcProps {
  completed: number;
  total: number;
}

/**
 * Small circular progress ring for tour completion. Stroke uses `currentColor`,
 * so the caller tints it by setting a text color on an ancestor. Shared by the
 * footer `TourLauncher` and the guided-tour minimized rail so both render the
 * same at-a-glance progress indicator.
 */
export function TourProgressArc({ completed, total }: TourProgressArcProps) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? completed / total : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg width={20} height={20} viewBox="0 0 20 20" className="flex-shrink-0">
      <circle cx={10} cy={10} r={radius} fill="none" stroke="currentColor" strokeWidth={2} opacity={0.2} />
      <circle
        cx={10}
        cy={10}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
        className="transition-all duration-300"
      />
    </svg>
  );
}
