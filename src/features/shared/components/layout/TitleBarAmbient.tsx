import { Sunrise, Sun, Sunset, Moon, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { useTimeOfDay, type TimeOfDay } from '@/hooks/utility/useTimeOfDay';

const PHASE_ICONS: Record<TimeOfDay, LucideIcon> = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};

interface AmbientProps {
  phase?: TimeOfDay;
}

export function TitleBarAmbient() {
  const enabled = useThemeStore((s) => s.ambientTimeOfDay);
  const phase = useTimeOfDay();
  if (!enabled) return null;
  return <AmbientDeco phase={phase} />;
}

export function AmbientDeco({ phase }: AmbientProps) {
  const active: TimeOfDay = phase ?? 'day';
  const Icon = PHASE_ICONS[active];
  return (
    <div className="ambient-deco" data-phase={active} aria-hidden>
      <PhaseDeco phase={active} side="left" />
      <Icon size={30} strokeWidth={1.4} className="ambient-deco-icon" />
      <PhaseDeco phase={active} side="right" />
    </div>
  );
}

function PhaseDeco({ phase, side }: { phase: TimeOfDay; side: 'left' | 'right' }) {
  switch (phase) {
    case 'dawn':  return <DawnDeco side={side} />;
    case 'day':   return <DayDeco side={side} />;
    case 'dusk':  return <DuskDeco side={side} />;
    case 'night': return <NightDeco side={side} />;
  }
}

const SVG_PROPS = {
  width: 128,
  height: 40,
  viewBox: '0 0 64 20',
  xmlns: 'http://www.w3.org/2000/svg',
  className: 'ambient-deco-svg',
} as const;

function DawnDeco({ side }: { side: 'left' | 'right' }) {
  return (
    <svg {...SVG_PROPS}>
      {/* Horizon line */}
      <line x1="2" y1="14" x2="62" y2="14" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.55" />
      {side === 'left' ? (
        <>
          {/* Last fading stars on the night-side */}
          <circle cx="14" cy="5" r="0.9" fill="currentColor" opacity="0.55" />
          <circle cx="34" cy="8" r="0.6" fill="currentColor" opacity="0.4" />
          <circle cx="50" cy="4" r="0.5" fill="currentColor" opacity="0.3" />
        </>
      ) : (
        <>
          {/* Two warming rays climbing right */}
          <line x1="6" y1="10" x2="18" y2="4" stroke="currentColor" strokeWidth="0.55" strokeLinecap="round" opacity="0.5" />
          <line x1="14" y1="11" x2="30" y2="7" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" opacity="0.4" />
        </>
      )}
    </svg>
  );
}

function DayDeco({ side }: { side: 'left' | 'right' }) {
  // Three short rays angled toward the icon + one wisp of cloud
  const towardLeft = side === 'right';
  return (
    <svg {...SVG_PROPS}>
      {towardLeft ? (
        <>
          <line x1="6" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
          <line x1="6" y1="4" x2="14" y2="6" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.55" />
          <line x1="6" y1="16" x2="14" y2="14" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.55" />
          <path d="M 28 13 q 6 -2 12 0 q 5 -1 12 1" stroke="currentColor" strokeWidth="0.6" fill="none" strokeLinecap="round" opacity="0.4" />
        </>
      ) : (
        <>
          <line x1="48" y1="10" x2="58" y2="10" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
          <line x1="50" y1="6" x2="58" y2="4" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.55" />
          <line x1="50" y1="14" x2="58" y2="16" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.55" />
          <path d="M 4 7 q 6 -2 12 0 q 5 -1 12 1" stroke="currentColor" strokeWidth="0.6" fill="none" strokeLinecap="round" opacity="0.4" />
        </>
      )}
    </svg>
  );
}

function DuskDeco({ side }: { side: 'left' | 'right' }) {
  return (
    <svg {...SVG_PROPS}>
      {/* Three sediment bands across the strip */}
      <line x1="2" y1="11" x2="62" y2="11" stroke="currentColor" strokeWidth="0.7" opacity="0.55" />
      <line x1="2" y1="14" x2="62" y2="14" stroke="currentColor" strokeWidth="0.6" opacity="0.38" />
      <line x1="2" y1="17" x2="62" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.22" />
      {side === 'right' && (
        // Bird silhouette far right
        <path d="M 36 5 q 3 -2 6 0 q 3 -2 6 0" stroke="currentColor" strokeWidth="0.7" fill="none" strokeLinecap="round" opacity="0.6" />
      )}
    </svg>
  );
}

function NightDeco({ side }: { side: 'left' | 'right' }) {
  const stars =
    side === 'left'
      ? [
          { x: 8,  y: 5,  r: 0.9, op: 0.85 },
          { x: 22, y: 13, r: 0.55, op: 0.55 },
          { x: 38, y: 6,  r: 0.7, op: 0.7 },
          { x: 54, y: 15, r: 0.5, op: 0.45 },
        ]
      : [
          { x: 10, y: 6,  r: 0.55, op: 0.55 },
          { x: 22, y: 14, r: 0.8, op: 0.75 },
          { x: 40, y: 5,  r: 0.9, op: 0.85 },
          { x: 56, y: 12, r: 0.5, op: 0.45 },
        ];
  return (
    <svg {...SVG_PROPS}>
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="currentColor" opacity={s.op} />
      ))}
      {side === 'left' && (
        // Faint shooting-star streak
        <line x1="14" y1="17" x2="30" y2="11" stroke="currentColor" strokeWidth="0.4" strokeLinecap="round" opacity="0.4" />
      )}
    </svg>
  );
}
