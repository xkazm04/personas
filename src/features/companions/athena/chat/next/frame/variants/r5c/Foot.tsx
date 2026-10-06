/**
 * Folio · the foot. ONE object at the bottom of the screen: at rest it is the
 * running line (her mark, the conversation, her latest sentence); when the
 * page or the folio opens, the same element widens into the page's last line,
 * where you write to her. Its height is reported up so the page above can sit
 * exactly on it.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { Composer, type About } from './Composer';
import { FOLIO_EASE, latestReply } from './marks';
import { RunningLine } from './RunningLine';


export function Foot({
  engine,
  mode,
  about,
  onClearAbout,
  onOpen,
  onHeight,
  joined,
}: {
  engine: AthenaChatEngine;
  mode: 'rest' | 'write';
  about: About | null;
  onClearAbout: () => void;
  onOpen: () => void;
  onHeight: (px: number) => void;
  /** The page stands on the foot: square its top so the two read as one sheet. */
  joined: boolean;
}) {
  const { shouldAnimate } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const streaming = useAthenaStore((s) => s.streaming);
  const lastId = latestReply(engine.messages)?.id ?? null;
  // Read once the page has been open while her latest reply was on it.
  const [seenId, setSeenId] = useState<string | null>(null);
  if (mode === 'write' && lastId !== seenId) setSeenId(lastId);
  const unread = !!lastId && lastId !== seenId && !streaming;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  const fade = shouldAnimate
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
    : { initial: false as const };

  return (
    <div className="r5c-foot-seat">
      <motion.div
        ref={ref}
        layout
        transition={{ layout: { duration: shouldAnimate ? 0.4 : 0, ease: FOLIO_EASE } }}
        className={`r5c-foot ${mode}${joined && mode === 'write' ? ' joined' : ''}`}
        data-testid={mode === 'rest' ? 'companion-r5c-running-line' : 'companion-composer'}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {mode === 'rest' ? (
            <motion.div key="line" layout="position" {...fade}>
              <RunningLine engine={engine} unread={unread} onOpen={onOpen} />
            </motion.div>
          ) : (
            <motion.div key="write" layout="position" className="w-full" {...fade}>
              <Composer engine={engine} about={about} onClearAbout={onClearAbout} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
