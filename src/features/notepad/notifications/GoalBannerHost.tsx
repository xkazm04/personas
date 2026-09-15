// PROTOTYPE 2026-09-15 — variant B host: the souls-like title card.
//
// The grammar is borrowed from Elden Ring's "GREAT ENEMY FELLED": a dark band
// fading out at both ends, a serif caps line that fades in while it slowly
// swells, and a ghost copy of the same line blooming outward and dissolving.
// Here the tone is green, because the moment it marks is a goal landing.
// Non-interactive (`pointer-events-none`) and self-dismissing — a title card
// is a beat, not a thing to acknowledge.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { onGoalBanner, type GoalBannerEvent } from './goalBanner';

const HOLD_MS = 4200;
const TITLE_COLOR = 'rgb(167 243 208)';
const GLOW = '0 0 18px rgba(52, 211, 153, 0.55), 0 0 42px rgba(16, 185, 129, 0.35)';
const SERIF = '"Cormorant Garamond", "Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const EDGE_FADE = 'linear-gradient(90deg, transparent 0%, #000 22%, #000 78%, transparent 100%)';

export function GoalBannerHost() {
  const reduced = useReducedMotion() ?? false;
  const [current, setCurrent] = useState<GoalBannerEvent | null>(null);

  useEffect(() => onGoalBanner(setCurrent), []);

  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => setCurrent(null), HOLD_MS);
    return () => window.clearTimeout(id);
  }, [current]);

  return (
    <>
    {/* The announcement lives in a region mounted for the host's lifetime, so
        the text change is observable; the card itself is decoration. */}
    <span className="sr-only" role="status">
      {current ? [current.title, current.subtitle].filter(Boolean).join('. ') : ''}
    </span>
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-[20vh] z-[220] flex flex-col items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: reduced ? 0.2 : 1.1, ease: 'easeOut' } }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0.2 : 1.4, ease: 'easeIn' } }}
        >
          {/* The band — dark in the middle, dissolving at both ends. */}
          <div
            aria-hidden
            className="absolute inset-x-0 h-40"
            style={{
              background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.78) 30%, rgba(0,0,0,0.78) 70%, transparent 100%)',
              maskImage: EDGE_FADE,
              WebkitMaskImage: EDGE_FADE,
            }}
          />
          {/* Hairlines above and below, drawn outward from the centre. */}
          {[-58, 58].map((offset) => (
            <motion.div
              key={offset}
              aria-hidden
              className="absolute h-px w-[56vw]"
              style={{
                transform: `translateY(${offset}px)`,
                background: 'linear-gradient(90deg, transparent, rgba(52,211,153,0.7), transparent)',
              }}
              initial={{ scaleX: reduced ? 1 : 0 }}
              animate={{ scaleX: 1, transition: { duration: 1.2, ease: 'easeOut' } }}
            />
          ))}

          <div className="relative flex items-center justify-center">
            {/* Ghost bloom — the same line, swelling out and dissolving. */}
            {!reduced && (
              <motion.span
                aria-hidden
                className="absolute whitespace-nowrap uppercase"
                style={{ fontFamily: SERIF, color: TITLE_COLOR, fontSize: 'clamp(2rem, 4.6vw, 4rem)', letterSpacing: '0.18em' }}
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: 0, scale: 1.22, transition: { duration: 1.8, ease: 'easeOut', delay: 0.25 } }}
              >
                {current.title}
              </motion.span>
            )}
            <motion.span
              className="relative whitespace-nowrap uppercase"
              style={{
                fontFamily: SERIF,
                color: TITLE_COLOR,
                textShadow: GLOW,
                fontSize: 'clamp(2rem, 4.6vw, 4rem)',
                letterSpacing: '0.18em',
              }}
              initial={{ scale: 1 }}
              animate={{ scale: reduced ? 1 : 1.05, transition: { duration: HOLD_MS / 1000 + 1.4, ease: 'linear' } }}
            >
              {current.title}
            </motion.span>
          </div>

          {current.subtitle && (
            <motion.span
              className="relative mt-3 max-w-[60vw] truncate uppercase"
              style={{ fontFamily: SERIF, color: 'rgba(209, 250, 229, 0.72)', fontSize: '0.95rem', letterSpacing: '0.32em' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 1, delay: reduced ? 0 : 0.6 } }}
            >
              {current.subtitle}
            </motion.span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}

export default GoalBannerHost;
