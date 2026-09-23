/**
 * The collectible card of Halo · Spread: `CardFace` (the ornate front that
 * frames the REAL `WorkItemBody`) and `CardBack` (the woven back the deck, the
 * discard pile and the flip show). `useCardTilt` gives the face its
 * pointer-driven 3D tilt, flat again on leave.
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

import { motion, useMotionValue, useSpring, type MotionStyle } from 'framer-motion';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { KIND_VAR } from '../../../tones';
import { NEXT_COPY as C } from '../../../nextCopy';
import { WorkItemBody } from '../../../WorkItemBody';
import type { WorkItem } from '../../../useWorkforce';
import { CORNERS, KIND_GLYPH, filigreeStyle, mix, monogram, projectHue, ringGradient, weaveStyle } from './cardArt';
import { SPREAD_COPY as S } from './copy';

const TILT_MAX = 5;

export function useCardTilt(enabled: boolean) {
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, { stiffness: 220, damping: 20 });
  const rotateY = useSpring(ry, { stiffness: 220, damping: 20 });
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled) return;
    const b = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - b.left) / b.width - 0.5;
    const py = (e.clientY - b.top) / b.height - 0.5;
    ry.set(px * TILT_MAX * 2);
    rx.set(-py * TILT_MAX * 2);
  };
  const onPointerLeave = () => {
    rx.set(0);
    ry.set(0);
  };
  const style: MotionStyle = { rotateX, rotateY, transformPerspective: 1400 };
  return { style, onPointerMove, onPointerLeave };
}

function Filigree({ color, size }: { color: string; size: number }) {
  return (
    <div className="absolute inset-[7px] pointer-events-none" aria-hidden>
      {CORNERS.map((c) => (
        <span key={c.key} className={`absolute ${c.className}`} style={{ ...filigreeStyle(color, size), transform: c.transform }} />
      ))}
    </div>
  );
}

/** The woven back. Fills its parent. */
export function CardBack({ color = 'var(--primary)', compact = false }: { color?: string; compact?: boolean }) {
  return (
    <div className="w-full h-full rounded-card p-[2px] shadow-elevation-2" style={{ background: ringGradient(color) }}>
      <div className="relative w-full h-full rounded-card overflow-hidden" style={weaveStyle(color)}>
        <div className="absolute inset-[4px] rounded-card border pointer-events-none" style={{ borderColor: mix(color, 45) }} />
        {!compact && <Filigree color={color} size={18} />}
        <div className="absolute inset-0 grid place-items-center" aria-hidden>
          <span
            className={`grid place-items-center rounded-full border typo-heading text-foreground ${compact ? 'w-6 h-6 typo-caption' : 'w-12 h-12'}`}
            style={{ borderColor: mix(color, 70), background: mix(color, 22, 'var(--background)'), boxShadow: `0 0 18px -4px ${color}` }}
          >
            A
          </span>
        </div>
      </div>
    </div>
  );
}

/** The art window: her portrait for her own cards, a monogram for a project's. */
function ArtWindow({ item, color, height }: { item: WorkItem; color: string; height: number }) {
  const Glyph = KIND_GLYPH[item.kind];
  const hue = item.project ? projectHue(item.project) : 'var(--primary)';
  return (
    <div
      className="relative mx-4 mt-2 shrink-0 rounded-card overflow-hidden border"
      style={{
        height,
        borderColor: mix(color, 55),
        background: `radial-gradient(120% 140% at 50% 0%, ${mix(color, 38, 'var(--background)')} 0%, ${mix(hue, 16, 'var(--background)')} 60%, var(--background) 100%)`,
      }}
    >
      {item.project ? (
        <span
          className="absolute -right-2 -bottom-6 typo-hero select-none"
          style={{ fontSize: height * 1.1, lineHeight: 1, color: mix('var(--foreground)', 10) }}
          aria-hidden
        >
          {monogram(item.project)}
        </span>
      ) : (
        <img
          src="/athena/athena_baseline.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-55"
          style={{ objectPosition: '50% 22%', maskImage: 'linear-gradient(90deg, transparent, black 30%, black 70%, transparent)' }}
        />
      )}
      <div className="absolute inset-0 grid place-items-center">
        <span
          className="grid place-items-center rounded-full border-2"
          style={{
            width: Math.min(64, height - 16),
            height: Math.min(64, height - 16),
            borderColor: color,
            background: mix(color, 20, 'var(--background)'),
            boxShadow: `0 0 26px -6px ${color}, inset 0 0 12px -4px ${color}`,
          }}
        >
          <Glyph className="w-1/2 h-1/2 text-foreground" aria-hidden />
        </span>
      </div>
      <span
        className="absolute left-2 bottom-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 typo-caption text-foreground bg-background/80"
        style={{ borderColor: mix(hue, 60) }}
      >
        <span className="grid place-items-center w-5 h-5 rounded-full typo-label text-foreground" style={{ background: mix(hue, 40) }}>
          {item.project ? monogram(item.project) : 'A'}
        </span>
        {item.project ?? S.athenaOwn}
      </span>
    </div>
  );
}

/** The ornate front of one decision card, framing the product's own card. */
export function CardFace({
  item,
  index,
  total,
  compact,
  sheen,
  onSend,
  onSetAside,
}: {
  item: WorkItem;
  index: number;
  total: number;
  /** A short stage: a slimmer art window. */
  compact: boolean;
  /** Play the one-time foil sweep. */
  sheen: boolean;
  onSend: (text: string) => void;
  onSetAside: () => void;
}) {
  const color = KIND_VAR[item.kind];
  return (
    <div className="relative w-full h-full rounded-modal p-[3px] shadow-elevation-4" style={{ background: ringGradient(color), boxShadow: `0 24px 60px -18px ${mix(color, 55)}` }}>
      <div className="relative w-full h-full rounded-modal bg-background overflow-hidden flex flex-col">
        <div className="absolute inset-[5px] rounded-card border pointer-events-none" style={{ borderColor: mix(color, 45) }} aria-hidden />
        <Filigree color={color} size={30} />

        {/* Title band */}
        <div
          className="relative mx-4 mt-4 shrink-0 rounded-interactive border px-4 py-2.5 flex items-start gap-3"
          style={{ borderColor: mix(color, 70), background: `linear-gradient(90deg, ${mix(color, 42, 'var(--background)')}, ${mix(color, 14, 'var(--background)')})` }}
        >
          <div className="min-w-0 flex-1">
            <p className="typo-label uppercase tracking-wider text-foreground">{C.kind[item.kind]}</p>
            <h2 className="typo-heading text-foreground leading-snug line-clamp-2">{item.title}</h2>
          </div>
          <span
            className="shrink-0 grid place-items-center w-9 h-9 rotate-45 rounded-interactive border typo-data text-foreground"
            style={{ borderColor: color, background: mix(color, 25, 'var(--background)') }}
            aria-label={S.cardOf(index + 1, total)}
          >
            <span className="-rotate-45">{index + 1}</span>
          </span>
        </div>

        <ArtWindow item={item} color={color} height={compact ? 64 : 104} />

        {/* Text panel: the real card */}
        <div
          className="relative mx-4 mt-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-card border p-4 bg-secondary/40"
          style={{ borderColor: mix(color, 30) }}
        >
          <WorkItemBody item={item} onSend={onSend} />
        </div>

        <div className="relative mx-4 my-3 shrink-0 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSetAside}
            className="rounded-interactive border border-foreground/15 px-3 py-1 typo-body text-foreground hover:bg-foreground/[0.06] focus-ring"
          >
            {S.setAside}
          </button>
          <span className="typo-caption text-foreground/85">{S.keysHint}</span>
        </div>

        {sheen && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(105deg, transparent 35%, ${mix(color, 28, 'var(--foreground)')} 48%, transparent 62%)`, mixBlendMode: 'overlay' }}
            initial={{ x: '-110%', opacity: 0.9 }}
            animate={{ x: '110%', opacity: 0.4 }}
            transition={{ duration: 0.9, ease: [0.3, 0.6, 0.2, 1] }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
