/**
 * The beat after a verdict: a small pill naming what just happened to which
 * item, in the verdict's tone. Hub clears it after ~1.2 s.
 */
import { motion } from 'framer-motion';
import { Check, CornerDownRight, X } from 'lucide-react';
import type { Leave } from './useSheetFlow';
import { COPY } from './copy';
import { TONE_CHIP } from './meta';

export interface Flash { key: number; leave: Leave; title: string }

const TONE: Record<Leave, 'success' | 'danger' | 'accent' | 'neutral'> = {
  accept: 'success', reply: 'success', reject: 'danger', done: 'accent', skip: 'neutral',
};

export function VerdictFlash({ flash, reduce }: { flash: Flash; reduce: boolean }) {
  const Icon = flash.leave === 'reject' ? X : flash.leave === 'skip' ? CornerDownRight : Check;
  return (
    <motion.div
      className={`p1-flash flex max-w-[28rem] items-center gap-1.5 border ${TONE_CHIP[TONE[flash.leave]]}`}
      style={{ x: '-50%' }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.18 }}
      role="status"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="typo-label whitespace-nowrap">{COPY.verdict[flash.leave]}</span>
      <span className="truncate typo-caption">{flash.title}</span>
    </motion.div>
  );
}
