export interface ActivityDot {
  id: string;
  /** Tailwind bg color class (e.g. 'bg-orange-500') */
  color: string;
  /** Ping animation color (omit for static dot) */
  pingColor?: string;
  /** Tooltip label */
  label: string;
}

interface ActivityDotsProps {
  dots: ActivityDot[];
}

/**
 * Renders a vertical stack of small colored indicator dots on the
 * center-right edge of a sidebar button.  Each dot represents one
 * active process (execution, build, lab, etc.) and all are visible
 * simultaneously — no priority collapsing.
 */
export function ActivityDots({ dots }: ActivityDotsProps) {
  if (dots.length === 0) return null;

  return (
    <span
      className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1"
      title={dots.map((d) => d.label).join(' · ')}
    >
      {dots.map((dot) => (
        <span key={dot.id} className="relative flex h-2.5 w-2.5 shrink-0">
          {dot.pingColor && (
            <span className={`absolute inset-0 rounded-full animate-ping ${dot.pingColor}`} />
          )}
          <span className={`relative w-2.5 h-2.5 rounded-full border border-white/10 ${dot.color}`} />
        </span>
      ))}
    </span>
  );
}
