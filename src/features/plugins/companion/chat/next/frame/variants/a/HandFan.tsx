/**
 * HandFan — the operator's hand: the waiting cards not on the table, fanned
 * at the bottom centre and tucked behind the input bar like cards held low.
 *
 * - Deal: on open each card flies in from the right edge on a staggered arc.
 * - Peek: hovering (or picking with 1-9) lifts a card, straightens it and
 *   shows its name plate above it. Clicking plays it.
 * - Return: when the stage closes, the cards fly back to the right edge.
 *
 * Under reduced motion the cards fade in place instead of flying.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { KIND_VAR } from '../../../tones';
import { NEXT_COPY as N } from '../../../nextCopy';
import type { WorkItem } from '../../../useWorkforce';
import { HAND_COPY as C } from './copy';
import { CardBackFace } from './CardBack';
import { GOLD, GOLD_DEEP, KIND_GLYPH } from './handTokens';

export const HAND_CARD = { w: 84, h: 118 };
/** How much of a hand card shows above the input bar at rest. */
export const HAND_VISIBLE = 74;

function fanPose(i: number, n: number) {
  const mid = (n - 1) / 2;
  const off = i - mid;
  const step = Math.min(9, 44 / Math.max(1, n));
  const spacing = Math.min(62, 420 / Math.max(1, n));
  return { x: off * spacing, y: Math.abs(off) * Math.abs(off) * 2.2, rotate: off * step };
}

export function HandFan({
  cards,
  selectedId,
  dealing,
  leaving,
  onPlay,
}: {
  cards: WorkItem[];
  selectedId: string | null;
  dealing: boolean;
  leaving: boolean;
  onPlay: (id: string) => void;
}) {
  const { shouldAnimate } = useMotion();
  const [hovered, setHovered] = useState<string | null>(null);
  const n = cards.length;
  const offRight = typeof window === 'undefined' ? 900 : window.innerWidth * 0.62;

  return (
    <div
      role="list"
      aria-label={C.hand}
      className="absolute left-1/2 z-0"
      style={{ bottom: -(HAND_CARD.h - HAND_VISIBLE) - 16, width: 0, height: HAND_CARD.h }}
    >
      <AnimatePresence>
        {cards.map((it, i) => {
          const pose = fanPose(i, n);
          const lifted = hovered === it.id || selectedId === it.id;
          const Glyph = KIND_GLYPH[it.kind];
          const kind = KIND_VAR[it.kind];
          const flyIn = { x: offRight, y: -260, rotate: 38, opacity: 0 };
          const rest = lifted
            ? { x: pose.x, y: -HAND_CARD.h + HAND_VISIBLE - 18, rotate: pose.rotate * 0.25, scale: 1.08, opacity: 1 }
            : { x: pose.x, y: pose.y, rotate: pose.rotate, scale: 1, opacity: 1 };
          const away = { x: offRight, y: -220, rotate: 30, opacity: [1, 1, 0] };
          return (
            <motion.div
              key={it.id}
              role="listitem"
              className="absolute top-0 pointer-events-auto"
              style={{ left: -HAND_CARD.w / 2, width: HAND_CARD.w, height: HAND_CARD.h, zIndex: lifted ? 50 : i, transformOrigin: '50% 100%' }}
              initial={shouldAnimate ? (dealing ? flyIn : { y: 40, opacity: 0 }) : { opacity: 0 }}
              animate={leaving ? (shouldAnimate ? away : { opacity: 0 }) : shouldAnimate ? rest : { opacity: 1, x: pose.x, y: pose.y, rotate: pose.rotate }}
              exit={shouldAnimate ? { y: -60, opacity: 0, scale: 0.9, transition: { duration: 0.18 } } : { opacity: 0 }}
              transition={
                !shouldAnimate
                  ? { duration: 0.15 }
                  : leaving
                    ? // Home to the deck: a deliberate throw, the last card first.
                      { type: 'tween', duration: 0.4, ease: [0.5, 0, 0.75, 0], delay: (n - 1 - i) * 0.04 }
                    : { type: 'spring', stiffness: 260, damping: 24, delay: dealing ? 0.08 + i * 0.08 : 0 }
              }
            >
              <button
                type="button"
                data-hand-card
                onClick={() => onPlay(it.id)}
                onMouseEnter={() => setHovered(it.id)}
                onMouseLeave={() => setHovered((h) => (h === it.id ? null : h))}
                onFocus={() => setHovered(it.id)}
                onBlur={() => setHovered((h) => (h === it.id ? null : h))}
                aria-label={`${C.handCard(i + 1, N.kind[it.kind], it.title)}. ${C.play}`}
                className="relative block w-full h-full focus-ring rounded-[10px]"
                style={{ filter: lifted ? `drop-shadow(0 10px 18px color-mix(in srgb, ${kind} 45%, transparent))` : 'drop-shadow(0 6px 10px color-mix(in srgb, var(--background) 70%, transparent))' }}
              >
                <CardBackFace kindColor={kind} size="hand" />
                {/* Kind gem, top centre. */}
                <span
                  className="absolute left-1/2 top-2 -translate-x-1/2 grid place-items-center w-7 h-7 rotate-45 rounded-[6px]"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, padding: 1.5 }}
                  aria-hidden
                >
                  <span className="grid place-items-center w-full h-full rounded-[5px]" style={{ background: kind }}>
                    <Glyph className="-rotate-45 w-3.5 h-3.5 text-background" />
                  </span>
                </span>
                {/* Pick number, top-left corner. */}
                {i < 9 && (
                  <span
                    className="absolute left-1.5 top-1.5 grid place-items-center w-5 h-5 rounded-full typo-caption leading-none text-background"
                    style={{ background: GOLD }}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                )}
              </button>
              {/* The name plate of a lifted card. */}
              <AnimatePresence>
                {lifted && !leaving && (
                  <motion.span
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.14 }}
                    className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[240px] rounded-card border px-3 py-2 bg-background/95 shadow-elevation-3"
                    style={{ borderColor: kind, rotate: -pose.rotate * 0.25 }}
                  >
                    <span className="block typo-label uppercase tracking-wider" style={{ color: kind }}>
                      {N.kind[it.kind]}
                      {it.project ? ` · ${it.project}` : ''}
                    </span>
                    <span className="block typo-body text-foreground line-clamp-2">{it.title}</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
