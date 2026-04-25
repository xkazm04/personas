import { useMotion } from '@/hooks/utility/interaction/useMotion';

export function HealedBurst() {
  const { shouldAnimate } = useMotion();
  if (!shouldAnimate) return null;

  return (
    <svg
      className="healed-burst pointer-events-none absolute inset-0 w-full h-full"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      role="presentation"
    >
      <line
        x1="0.5"
        y1="0"
        x2="0.5"
        y2="40"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinecap="round"
        className="healed-burst__edge"
      />
      <g className="healed-burst__check" transform="translate(8 20)">
        <path
          d="M-3 0l2.5 2.5L4 -3"
          fill="none"
          stroke="#10b981"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          className="healed-burst__check-path"
        />
      </g>
      <g className="healed-burst__sparkles" transform="translate(8 20)">
        <circle r="0.8" fill="#10b981" className="healed-burst__sparkle healed-burst__sparkle--1" />
        <circle r="0.8" fill="#34d399" className="healed-burst__sparkle healed-burst__sparkle--2" />
        <circle r="0.7" fill="#10b981" className="healed-burst__sparkle healed-burst__sparkle--3" />
        <circle r="0.7" fill="#34d399" className="healed-burst__sparkle healed-burst__sparkle--4" />
        <circle r="0.6" fill="#6ee7b7" className="healed-burst__sparkle healed-burst__sparkle--5" />
      </g>
    </svg>
  );
}
