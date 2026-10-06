/**
 * The stage's moving part. Walking slides with direction (→ enters from the
 * right); a verdict makes the item LEAVE toward its meaning — accepted rises
 * away up-right, rejected sinks down-left, read/done lifts off — while a
 * stamp names what just happened. Reduced motion: short cross-fades only.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { DUR, EASE } from './model';
import type { DeskCtl, Exit, Stamp } from './useDesk';
import { ApprovalStage } from './stages/ApprovalStage';
import { BacklogStage } from './stages/BacklogStage';
import { ReportStage } from './stages/ReportStage';
import { ChatThread } from './stages/ChatStage';

interface Motion { dir: 1 | -1; exit: Exit; reduced: boolean }

const VARIANTS: Variants = {
  enter: ({ dir, reduced }: Motion) => (reduced ? { opacity: 0 } : { opacity: 0, x: 56 * dir }),
  center: { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, transition: { duration: DUR.normal, ease: EASE } },
  leave: ({ dir, exit, reduced }: Motion) => {
    const t = { duration: DUR.normal, ease: EASE };
    if (reduced) return { opacity: 0, transition: { duration: DUR.fast } };
    if (exit === 'accept' || exit === 'reply') return { opacity: 0, x: 40, y: -48, scale: 0.94, transition: t };
    if (exit === 'reject') return { opacity: 0, x: -40, y: 56, rotate: -2, scale: 0.94, transition: t };
    if (exit === 'done') return { opacity: 0, y: -32, scale: 0.97, transition: t };
    return { opacity: 0, x: -56 * dir, transition: t };
  },
};

export function DeskStage({ ctl, reduced }: { ctl: DeskCtl; reduced: boolean }) {
  const item = ctl.item;
  const custom: Motion = { dir: ctl.dir, exit: ctl.exit, reduced };
  const bodyRef = ctl.bodyRef;
  const type = ctl.type;

  // A chat opens at its tail (the question); everything else opens at the top.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = type === 'chat' ? el.scrollHeight : 0;
  }, [item?.id, type, bodyRef]);

  if (!item) return null;
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={custom}>
      <motion.div key={item.id} custom={custom} variants={VARIANTS} initial="enter" animate="center" exit="leave"
        className="w-full" data-testid="p3-stage-item">
        {type === 'approval' && <ApprovalStage item={item} ctl={ctl} />}
        {type === 'backlog' && <BacklogStage item={item} />}
        {type === 'report' && <ReportStage item={item} />}
        {type === 'chat' && <ChatThread item={item} />}
      </motion.div>
    </AnimatePresence>
  );
}

const STAMP_INK = { success: 'text-status-success', error: 'text-status-error', info: 'text-status-info' } as const;

export function VerdictStamp({ stamp, reduced }: { stamp: Stamp | null; reduced: boolean }) {
  return (
    <AnimatePresence>
      {stamp && (
        <motion.div key={stamp.key} className={`p3-stamp ${STAMP_INK[stamp.tone]}`} aria-hidden
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35, rotate: -6 }}
          animate={{ opacity: 1, scale: 1, rotate: -3, transition: { duration: DUR.fast, ease: EASE } }}
          exit={{ opacity: 0, transition: { duration: DUR.normal } }}>
          <span className="typo-heading-lg">{stamp.label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
