/**
 * Level 3 — the sheet. ONE shell on BaseModal for all four types: chrome bar,
 * item head, one scroll region (the reader owns its own), decision footer.
 *
 * Motion: the sheet grows out of where it was opened from (chip or peek row)
 * and returns there on close; items walk in from the side you walked toward;
 * a decided item leaves in the shape of its verdict (accept lifts away, reject
 * drops, done settles) and a small verdict flash confirms it.
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { modalTypeOf, type DecisionItem, type DecisionModalType } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';
import { ApprovalBody } from './ApprovalBody';
import { BacklogBody } from './BacklogBody';
import { ChatComposer, ChatThread } from './ChatBody';
import { EASE_OUT, isTypingTarget } from './meta';
import { ReportBody } from './ReportBody';
import { ItemHead, SheetBar } from './SheetHead';
import { SheetFooter } from './SheetFooter';
import { useSheetFlow, type Leave } from './useSheetFlow';
import { useSheetKeys } from './useSheetKeys';
import { VerdictFlash, type Flash } from './VerdictFlash';

export interface Origin { x: number; y: number }

const WIDTH: Record<DecisionModalType, string> = {
  approval: '48rem', backlog: '60rem', chat: '46rem', report: '78rem',
};

const CONTENT: Variants = {
  enter: ({ dir }: { dir: number }) => ({ opacity: 0, x: dir * 56 }),
  center: { opacity: 1, x: 0, y: 0, scale: 1, transition: { duration: 0.22, ease: EASE_OUT } },
  exit: ({ dir, leave }: { dir: number; leave: Leave | null }) => {
    const t = { duration: 0.18, ease: 'easeIn' as const };
    if (leave === 'accept' || leave === 'reply') return { opacity: 0, y: -36, scale: 0.98, transition: t };
    if (leave === 'reject') return { opacity: 0, y: 36, scale: 0.98, transition: t };
    if (leave === 'done') return { opacity: 0, scale: 0.96, transition: t };
    return { opacity: 0, x: -dir * 56, transition: { duration: 0.14, ease: 'easeIn' as const } };
  },
};
const CONTENT_REDUCED: Variants = {
  enter: { opacity: 0 }, center: { opacity: 1, transition: { duration: 0.12 } }, exit: { opacity: 0, transition: { duration: 0.1 } },
};

function fromOrigin(o: Origin | null) {
  if (!o || typeof window === 'undefined') return { opacity: 0, scale: 0.96, x: 0, y: 12 };
  return { opacity: 0, scale: 0.5, x: o.x - window.innerWidth / 2, y: o.y - window.innerHeight / 2 };
}

interface DecisionSheetProps {
  open: boolean;
  item: DecisionItem | null;
  index: number;
  total: number;
  scope: string;
  origin: Origin | null;
  exitOrigin: Origin | null;
  dir: 1 | -1;
  leave: Leave | null;
  flash: Flash | null;
  onWalk: (d: 1 | -1) => void;
  onClose: () => void;
  onVerdict: (v: PrototypeVerdict, leave: Leave) => void;
}

export function DecisionSheet(p: DecisionSheetProps) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);
  const flow = useSheetFlow(p.item, p.onVerdict, focusComposer);
  const item = p.item;
  const type = item ? modalTypeOf(item.kind) : 'approval';
  useSheetKeys({ enabled: p.open && !!item, flow, scrollRef, onWalk: p.onWalk, focusComposer, isReport: item?.kind === 'report' });

  // BaseModal focuses the first control (the walk-back chevron). Take focus onto
  // the sheet itself one frame later: keys work from anywhere, and no control
  // wears a focus ring the user never asked for.
  const isOpen = p.open && !!item;
  useEffect(() => {
    if (!isOpen) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true })); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [isOpen]);

  // Esc and the backdrop both arrive here (BaseModal). One step back per press:
  // leave the field you are typing in, else disarm a verdict, else close.
  const { onClose } = p;
  const requestClose = useCallback(() => {
    const active = document.activeElement;
    if (isTypingTarget(active) && sheetRef.current?.contains(active)) {
      sheetRef.current.focus({ preventScroll: true });
      return;
    }
    if (flow.cancel()) return;
    onClose();
  }, [flow, onClose]);

  const custom = { dir: p.dir, leave: p.leave };
  return (
    <BaseModal
      isOpen={p.open && !!item}
      onClose={requestClose}
      titleId={titleId}
      portal
      staggerChildren={false}
      maxWidthClass="max-w-[78rem]"
      panelClassName="pointer-events-none flex justify-center"
    >
      <motion.div
        ref={sheetRef}
        tabIndex={-1}
        className={`p1-sheet relative outline-none ${type === 'report' ? 'h-[88vh]' : 'max-h-[86vh]'}`}
        data-testid="p1-sheet"
        initial={reduce ? { opacity: 0 } : fromOrigin(p.origin)}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0, maxWidth: WIDTH[type] }}
        exit={reduce ? { opacity: 0 } : { ...fromOrigin(p.exitOrigin), transition: { duration: 0.2, ease: 'easeIn' } }}
        transition={reduce ? { duration: 0.12 } : { duration: 0.28, ease: EASE_OUT, delay: 0.08, maxWidth: { duration: 0.25, ease: EASE_OUT } }}
      >
        {item && (
          <>
            <SheetBar item={item} index={p.index} total={p.total} scope={p.scope} onWalk={p.onWalk} onClose={p.onClose} />
            <AnimatePresence>{p.flash && <VerdictFlash key={p.flash.key} flash={p.flash} reduce={reduce} />}</AnimatePresence>
            <AnimatePresence mode="wait" custom={custom} initial={false}>
              <motion.div
                key={item.id}
                custom={custom}
                variants={reduce ? CONTENT_REDUCED : CONTENT}
                initial="enter"
                animate="center"
                exit="exit"
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* The ask never scrolls away: the head sits above the one scroll region. */}
                <ItemHead item={item} titleId={titleId} />
                {type === 'report' ? (
                  <ReportBody item={item} scrollRef={scrollRef} />
                ) : (
                  <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pt-1">
                    {type === 'approval' && <ApprovalBody item={item} flow={flow} />}
                    {type === 'backlog' && <BacklogBody item={item} />}
                    {type === 'chat' && <ChatThread item={item} />}
                  </div>
                )}
                {type === 'chat' && <ChatComposer item={item} flow={flow} composerRef={composerRef} />}
              </motion.div>
            </AnimatePresence>
            <SheetFooter item={item} flow={flow} reduce={reduce} />
          </>
        )}
      </motion.div>
    </BaseModal>
  );
}
