/**
 * Orbit dots for the Agents sidebar button.
 *
 * Positions up to N colored dots in an arc around the right edge of the
 * parent button. Each dot represents one active task tied to a specific
 * persona:
 *   - Purple — draft / template adoption in progress
 *   - Blue   — execution (foreground or background) in progress
 *   - Orange — lab run in progress (arena, matrix, A/B, eval)
 *
 * Clicking a dot selects the underlying persona and jumps to its detail
 * view. Hovering shows a tooltip with the persona name and task type.
 *
 * The orbit layout is deterministic: dots are placed on a right-side arc
 * from roughly 4 o'clock up to 2 o'clock, evenly spaced. Overflow (>6 dots)
 * collapses into a single "+N" counter dot at the end so the arc stays
 * tight around the button.
 */
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import type { AgentActivity, AgentActivityType } from '@/hooks/sidebar/useSidebarAgentActivity';

const MAX_VISIBLE_DOTS = 6;

/** Tailwind color classes per activity type. */
const COLOR: Record<AgentActivityType, { dot: string; ping: string; title: string }> = {
  draft: { dot: 'bg-violet-500', ping: 'bg-violet-500/40', title: 'Draft' },
  exec:  { dot: 'bg-blue-500',   ping: 'bg-blue-500/40',   title: 'Execution' },
  lab:   { dot: 'bg-orange-500', ping: 'bg-orange-500/40', title: 'Lab run' },
};

/**
 * Distribute N items along a right-side arc around the button.
 * The arc spans the right half (top-right to bottom-right, about 120deg),
 * centered on the right edge. For a 76px-wide button, the dots sit ~22px
 * out from center, giving a crisp orbit that doesn't eat layout space.
 */
function positionFor(index: number, total: number, radius = 22): { x: number; y: number } {
  // Start at -50deg (top-right) and end at +50deg (bottom-right).
  // Single dot → dead center on the right (0deg).
  const arcStart = -50;
  const arcEnd = 50;
  const angleDeg = total === 1 ? 0 : arcStart + (index * (arcEnd - arcStart)) / (total - 1);
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.cos(angleRad) * radius,
    y: Math.sin(angleRad) * radius,
  };
}

interface OrbitDotsProps {
  activities: AgentActivity[];
}

export function OrbitDots({ activities }: OrbitDotsProps) {
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);

  if (activities.length === 0) return null;

  const visible = activities.slice(0, MAX_VISIBLE_DOTS);
  const overflow = activities.length - visible.length;
  // When we overflow, the last slot shows a "+N" counter; so the visible
  // slot count for positioning is visible.length (or visible.length + 1
  // with overflow).
  const slotCount = visible.length + (overflow > 0 ? 1 : 0);

  const handleClick = (a: AgentActivity) => {
    // Jump to the Agents section with the persona selected. The persona
    // detail view renders inside the "all" tab when an individual persona
    // is selected.
    setSidebarSection('personas');
    setAgentTab('all');
    selectPersona(a.personaId);
  };

  return (
    <span
      aria-hidden="false"
      className="pointer-events-none absolute inset-0 z-20"
    >
      {visible.map((a, i) => {
        const { x, y } = positionFor(i, slotCount);
        const meta = COLOR[a.type];
        return (
          <button
            key={a.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClick(a);
            }}
            title={`${a.personaName} — ${a.label}`}
            aria-label={`${a.personaName}: ${a.label}`}
            className="pointer-events-auto absolute top-1/2 left-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full hover:scale-125 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
          >
            <span className={`absolute inset-0 rounded-full animate-ping ${meta.ping}`} />
            <span className={`relative block w-2.5 h-2.5 rounded-full border border-black/20 shadow-[0_0_4px_rgba(0,0,0,0.4)] ${meta.dot}`} />
          </button>
        );
      })}
      {overflow > 0 && (() => {
        const { x, y } = positionFor(visible.length, slotCount);
        return (
          <span
            key="overflow"
            title={`+${overflow} more`}
            className="pointer-events-auto absolute top-1/2 left-1/2 flex items-center justify-center min-w-[18px] h-[14px] px-1 text-[9px] font-semibold rounded-full bg-foreground/80 text-background"
            style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
          >
            +{overflow}
          </span>
        );
      })()}
    </span>
  );
}
