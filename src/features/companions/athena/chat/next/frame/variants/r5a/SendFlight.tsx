/**
 * SendFlight - your message leaves the composer and lands in the transcript
 * as the SAME words moving, not a field clearing and a new row popping in.
 *
 * On send the composer reports where its text was; once the optimistic turn
 * renders (`athenaChatSend` appends it before the IPC round-trip), the real
 * ask is hidden, a copy flies from the composer to the ask's exact box, and
 * the real one is shown again under it. Reduced motion: no flight, the turn
 * simply appears. If the ask never renders (the decision sheet is open, the
 * message was queued behind a running turn) nothing flies.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

interface Flight {
  id: number;
  text: string;
  from: { left: number; top: number; width: number };
  to: { left: number; top: number; width: number };
  target: HTMLElement;
}

const FRAMES_TO_WAIT = 24;

/** The newest turn's ask paragraph, when it says exactly `text`. */
function findAsk(scope: HTMLElement, text: string): HTMLElement | null {
  const turns = scope.querySelectorAll<HTMLElement>('[data-testid="athena-next-turn"]');
  const last = turns[turns.length - 1];
  const ask = last?.querySelector<HTMLElement>('p.typo-body-lg');
  return ask && ask.textContent?.trim() === text.trim() ? ask : null;
}

export function useSendFlight(scope: RefObject<HTMLElement | null>) {
  const { shouldAnimate } = useMotion();
  const [flight, setFlight] = useState<Flight | null>(null);
  const raf = useRef<number | null>(null);

  const launch = useCallback(
    (text: string, from: DOMRect) => {
      if (!shouldAnimate) return;
      // A key for the flying copy, not a guard: each send is its own flight.
      const id = performance.now();
      let frames = 0;
      const look = () => {
        const root = scope.current;
        const ask = root ? findAsk(root, text) : null;
        if (!ask) {
          raf.current = ++frames < FRAMES_TO_WAIT ? requestAnimationFrame(look) : null;
          return;
        }
        const to = ask.getBoundingClientRect();
        // Off the visible transcript (scrolled away): let it simply appear.
        if (to.bottom < 0 || to.top > window.innerHeight) return;
        ask.style.opacity = '0';
        setFlight({
          id,
          text,
          from: { left: from.left + 14, top: from.top + 6, width: Math.max(160, from.width - 28) },
          to: { left: to.left, top: to.top, width: to.width },
          target: ask,
        });
      };
      // Two frames: the turn renders, then the transcript pins to the bottom.
      raf.current = requestAnimationFrame(() => requestAnimationFrame(look));
    },
    [scope, shouldAnimate],
  );

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const flying = useRef<Flight | null>(null);
  flying.current = flight;
  const land = useCallback(() => {
    const f = flying.current;
    if (f) f.target.style.opacity = '';
    setFlight(null);
  }, []);

  return { flight, launch, land };
}

export function SendFlight({ flight, onLand }: { flight: Flight | null; onLand: () => void }) {
  if (!flight) return null;
  return (
    <motion.p
      key={flight.id}
      className="r5a-flight typo-body-lg"
      initial={{ left: flight.from.left, top: flight.from.top, width: flight.from.width, opacity: 0.85 }}
      animate={{ left: flight.to.left, top: flight.to.top, width: flight.to.width, opacity: 1 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={onLand}
      aria-hidden
    >
      {flight.text}
    </motion.p>
  );
}
