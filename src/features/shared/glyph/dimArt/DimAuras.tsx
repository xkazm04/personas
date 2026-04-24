/**
 * Direction B — lucide core + hand-crafted SVG aura frame, one per dimension.
 *
 * Each aura uses `currentColor` so the parent's `color` style (driven by
 * `DIM_META[dim].color`) paints both the ring art and the lucide icon with
 * the same hue. Shared `AuraFrame` wrapper draws the base rings; per-dim
 * decoration gives each leaf its own distinct motif.
 *
 * Distinct motifs:
 *   trigger   — clock-face ticks + orbit arc
 *   task      — ascending step-chevrons + progress dots
 *   connector — corner nodes + diagonal link lines
 *   message   — concentric wave arcs radiating sideways
 *   review    — arc brackets + cardinal scan-ticks
 *   memory    — paired dendritic filaments + shard particles
 *   event     — EKG waveform across the frame
 *   error     — octagonal ward (replaces base rings) + corner brackets
 */
import type { ReactNode } from 'react';
import {
  Calendar, ListTodo, Plug, MessageSquare,
  UserCheck, Brain, Activity, AlertTriangle,
} from 'lucide-react';

interface AuraFrameProps {
  size: number;
  decoration: ReactNode;
  icon: ReactNode;
  /** Skip the default circular base (used by error, which draws its own octagon). */
  hideBase?: boolean;
}
function AuraFrame({ size, decoration, icon, hideBase }: AuraFrameProps) {
  const iconSize = Math.round(size * 0.46);
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size} height={size}
        viewBox="0 0 72 72"
        className="absolute inset-0"
        fill="none" aria-hidden
      >
        {!hideBase && (
          <>
            <circle cx="36" cy="36" r="33" stroke="currentColor" strokeOpacity="0.26"
              strokeWidth="0.9" strokeDasharray="1.2 4" />
            <circle cx="36" cy="36" r="26" stroke="currentColor" strokeOpacity="0.4"
              strokeWidth="1" />
          </>
        )}
        {decoration}
      </svg>
      <div
        className="relative flex items-center justify-center"
        style={{ width: iconSize, height: iconSize }}
      >
        {icon}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function TriggerAura({ size }: { size: number }) {
  const ticks: ReactNode[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const isCardinal = i % 3 === 0;
    const r1 = isCardinal ? 28 : 30;
    const r2 = isCardinal ? 33 : 32;
    ticks.push(
      <line key={i}
        x1={36 + r1 * Math.cos(a)} y1={36 + r1 * Math.sin(a)}
        x2={36 + r2 * Math.cos(a)} y2={36 + r2 * Math.sin(a)}
        stroke="currentColor" strokeOpacity={isCardinal ? 0.75 : 0.4}
        strokeWidth={isCardinal ? 1.4 : 0.9} strokeLinecap="round"
      />
    );
  }
  const deco = (
    <>
      {ticks}
      {/* short orbit arc suggesting rotation */}
      <path d="M56 14 A 24 24 0 0 1 61 26"
        stroke="currentColor" strokeOpacity="0.6"
        strokeWidth="1.1" strokeLinecap="round" />
    </>
  );
  return <AuraFrame size={size} decoration={deco}
    icon={<Calendar style={{ width: '100%', height: '100%' }} />} />;
}

// ---------------------------------------------------------------------------

export function TaskAura({ size }: { size: number }) {
  const deco = (
    <>
      {/* ascending step-chevrons flanking the icon */}
      <path d="M8 44 L12 40 L8 36" stroke="currentColor" strokeOpacity="0.65"
        strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 40 L18 36 L14 32" stroke="currentColor" strokeOpacity="0.45"
        strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M64 44 L60 40 L64 36" stroke="currentColor" strokeOpacity="0.65"
        strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M58 40 L54 36 L58 32" stroke="currentColor" strokeOpacity="0.45"
        strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      {/* top progress dots */}
      <circle cx="30" cy="6" r="1.2" fill="currentColor" fillOpacity="0.7" />
      <circle cx="36" cy="5" r="1.6" fill="currentColor" />
      <circle cx="42" cy="6" r="1.2" fill="currentColor" fillOpacity="0.7" />
      {/* bottom anchor tick */}
      <line x1="36" y1="65" x2="36" y2="69"
        stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
    </>
  );
  return <AuraFrame size={size} decoration={deco}
    icon={<ListTodo style={{ width: '100%', height: '100%' }} />} />;
}

// ---------------------------------------------------------------------------

export function ConnectorAura({ size }: { size: number }) {
  const corners: Array<{ cx: number; cy: number }> = [
    { cx: 13, cy: 13 }, { cx: 59, cy: 13 },
    { cx: 13, cy: 59 }, { cx: 59, cy: 59 },
  ];
  const diagonals = [
    'M17 17 L26 26', 'M55 17 L46 26',
    'M17 55 L26 46', 'M55 55 L46 46',
  ];
  const deco = (
    <>
      {diagonals.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeOpacity="0.5"
          strokeWidth="1.1" strokeLinecap="round" />
      ))}
      {corners.map((c, i) => (
        <g key={i}>
          <circle cx={c.cx} cy={c.cy} r="2.6" fill="currentColor" fillOpacity="0.85" />
          <circle cx={c.cx} cy={c.cy} r="4.6" stroke="currentColor" strokeOpacity="0.3"
            strokeWidth="0.7" />
        </g>
      ))}
    </>
  );
  return <AuraFrame size={size} decoration={deco}
    icon={<Plug style={{ width: '100%', height: '100%' }} />} />;
}

// ---------------------------------------------------------------------------

export function MessageAura({ size }: { size: number }) {
  const deco = (
    <>
      {/* left wave arcs */}
      <path d="M2 32 Q 5 36 2 40"
        stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.2"
        strokeLinecap="round" />
      <path d="M6 28 Q 11 36 6 44"
        stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1"
        strokeLinecap="round" />
      <path d="M10 23 Q 17 36 10 49"
        stroke="currentColor" strokeOpacity="0.33" strokeWidth="1"
        strokeLinecap="round" />
      {/* right wave arcs (mirrored) */}
      <path d="M70 32 Q 67 36 70 40"
        stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.2"
        strokeLinecap="round" />
      <path d="M66 28 Q 61 36 66 44"
        stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1"
        strokeLinecap="round" />
      <path d="M62 23 Q 55 36 62 49"
        stroke="currentColor" strokeOpacity="0.33" strokeWidth="1"
        strokeLinecap="round" />
    </>
  );
  return <AuraFrame size={size} decoration={deco}
    icon={<MessageSquare style={{ width: '100%', height: '100%' }} />} />;
}

// ---------------------------------------------------------------------------

export function ReviewAura({ size }: { size: number }) {
  const deco = (
    <>
      {/* inspection arc brackets, top & bottom */}
      <path d="M22 6 A 28 28 0 0 1 50 6"
        stroke="currentColor" strokeOpacity="0.75"
        strokeWidth="1.4" strokeLinecap="round" />
      <path d="M22 66 A 28 28 0 0 0 50 66"
        stroke="currentColor" strokeOpacity="0.75"
        strokeWidth="1.4" strokeLinecap="round" />
      {/* cardinal scan-ticks */}
      <path d="M36 1 L36 7 M36 65 L36 71 M1 36 L7 36 M65 36 L71 36"
        stroke="currentColor" strokeOpacity="0.65"
        strokeWidth="1.3" strokeLinecap="round" />
      {/* diagonal micro-ticks */}
      <path d="M12 12 L15 15 M60 12 L57 15 M12 60 L15 57 M60 60 L57 57"
        stroke="currentColor" strokeOpacity="0.35"
        strokeWidth="0.8" strokeLinecap="round" />
    </>
  );
  return <AuraFrame size={size} decoration={deco}
    icon={<UserCheck style={{ width: '100%', height: '100%' }} />} />;
}

// ---------------------------------------------------------------------------

export function MemoryAura({ size }: { size: number }) {
  const deco = (
    <>
      {/* paired dendrite filaments from 4 cardinal entry points */}
      <path d="M36 2 Q 40 12 36 18" stroke="currentColor" strokeOpacity="0.6"
        strokeWidth="1.1" strokeLinecap="round" />
      <path d="M36 2 Q 32 12 36 18" stroke="currentColor" strokeOpacity="0.45"
        strokeWidth="0.9" strokeLinecap="round" />
      <path d="M70 36 Q 60 32 54 36" stroke="currentColor" strokeOpacity="0.6"
        strokeWidth="1.1" strokeLinecap="round" />
      <path d="M70 36 Q 60 40 54 36" stroke="currentColor" strokeOpacity="0.45"
        strokeWidth="0.9" strokeLinecap="round" />
      <path d="M36 70 Q 40 60 36 54" stroke="currentColor" strokeOpacity="0.6"
        strokeWidth="1.1" strokeLinecap="round" />
      <path d="M36 70 Q 32 60 36 54" stroke="currentColor" strokeOpacity="0.45"
        strokeWidth="0.9" strokeLinecap="round" />
      <path d="M2 36 Q 12 32 18 36" stroke="currentColor" strokeOpacity="0.6"
        strokeWidth="1.1" strokeLinecap="round" />
      <path d="M2 36 Q 12 40 18 36" stroke="currentColor" strokeOpacity="0.45"
        strokeWidth="0.9" strokeLinecap="round" />
      {/* memory-shard particles at filament tips */}
      <circle cx="36" cy="2" r="1.5" fill="currentColor" />
      <circle cx="70" cy="36" r="1.5" fill="currentColor" />
      <circle cx="36" cy="70" r="1.5" fill="currentColor" />
      <circle cx="2" cy="36" r="1.5" fill="currentColor" />
    </>
  );
  return <AuraFrame size={size} decoration={deco}
    icon={<Brain style={{ width: '100%', height: '100%' }} />} />;
}

// ---------------------------------------------------------------------------

export function EventAura({ size }: { size: number }) {
  const deco = (
    <>
      {/* EKG waveform across the frame */}
      <path
        d="M2 36 L 12 36 L 16 30 L 20 42 L 24 26 L 28 46 L 32 36 L 44 36 L 48 30 L 52 42 L 56 26 L 60 46 L 64 36 L 70 36"
        stroke="currentColor" strokeOpacity="0.58"
        strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"
      />
      {/* pulse dots top & bottom */}
      <circle cx="36" cy="5" r="1.6" fill="currentColor" />
      <circle cx="36" cy="67" r="1.6" fill="currentColor" />
    </>
  );
  return <AuraFrame size={size} decoration={deco}
    icon={<Activity style={{ width: '100%', height: '100%' }} />} />;
}

// ---------------------------------------------------------------------------

export function ErrorAura({ size }: { size: number }) {
  const deco = (
    <>
      {/* octagonal ward outline */}
      <path
        d="M 26 3 L 46 3 L 66 23 L 66 49 L 46 69 L 26 69 L 6 49 L 6 23 Z"
        stroke="currentColor" strokeOpacity="0.28"
        strokeWidth="0.9" strokeDasharray="1.2 4"
      />
      <path
        d="M 30 11 L 42 11 L 58 27 L 58 45 L 42 61 L 30 61 L 14 45 L 14 27 Z"
        stroke="currentColor" strokeOpacity="0.42"
        strokeWidth="1"
      />
      {/* L-shaped corner alert brackets */}
      <path
        d="M3 18 L3 10 L11 10 M61 10 L69 10 L69 18 M69 54 L69 62 L61 62 M11 62 L3 62 L3 54"
        stroke="currentColor" strokeOpacity="0.6"
        strokeWidth="1.25" strokeLinecap="round"
      />
    </>
  );
  return <AuraFrame size={size} decoration={deco} hideBase
    icon={<AlertTriangle style={{ width: '100%', height: '100%' }} />} />;
}
