/**
 * ThreadRail - the right edge: Athena's run threads as a slim column of
 * pills (one per live project lane, plus her own), which widens IN PLACE into
 * the thread board - the same lane objects, their shapes animated from pill
 * to lane while the column's glass becomes the board's. Alt+T or any pill
 * opens it; Esc or Alt+T folds it. A gate row opens that item in the island's
 * decision sheet.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircleMore, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { switchThread } from '../../../useWorkforce';
import { ThreadLaneWide, ThreadPill } from './ThreadLane';
import { ISLAND_COPY as I } from './copy';
import type { ThreadLane } from './useThreads';

export function ThreadRail({
  lanes,
  threads,
  open,
  onToggle,
  onOpenItem,
  onOpenChat,
}: {
  lanes: ThreadLane[];
  threads: { id: string; title: string; unread: number }[];
  open: boolean;
  onToggle: () => void;
  onOpenItem: (id: string) => void;
  onOpenChat: () => void;
}) {
  const { shouldAnimate } = useMotion();
  const morph = { duration: shouldAnimate ? 0.4 : 0, ease: [0.22, 1, 0.36, 1] as const };
  const reveal = { duration: shouldAnimate ? 0.22 : 0, delay: shouldAnimate ? 0.18 : 0 };
  if (lanes.length === 0 && !open) return null;
  const live = lanes.reduce((n, l) => n + l.live, 0);

  return (
    <div className="r5a-rail-seat">
      <motion.div
        layout
        transition={morph}
        className={`r5a-rail${open ? ' is-board r5a-glass is-open' : ''}`}
        role="region"
        aria-label={I.rail}
        data-testid={open ? 'companion-r5a-board' : 'companion-r5a-rail'}
        style={{ borderRadius: open ? 16 : 0 }}
      >
        {open && (
          <motion.div layout="position" className="r5a-board-head" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: reveal }}>
            <span className="flex flex-col min-w-0">
              <span className="typo-eyebrow text-primary">{I.board}</span>
              <span className="typo-caption">{I.boardSummary(lanes.length, live)}</span>
            </span>
            <span className="flex-1" />
            <span className="r5a-kbd typo-caption" aria-hidden>
              {I.keyThreads}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="!rounded-full"
              onClick={onToggle}
              aria-label={`${I.foldBoard} (${I.keyEsc})`}
              data-testid="companion-r5a-board-close"
              icon={<X className="w-4 h-4" aria-hidden />}
            />
          </motion.div>
        )}
        <motion.div layoutScroll className={open ? 'r5a-board-body' : 'flex flex-col gap-2.5'}>
          {lanes.map((lane) => (
            <motion.div key={lane.key} layout transition={morph} className={open ? 'r5a-lane' : ''}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={open ? 'wide' : 'slim'}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: reveal }}
                  exit={{ opacity: 0, transition: { duration: shouldAnimate ? 0.08 : 0 } }}
                >
                  {open ? (
                    <ThreadLaneWide lane={lane} onOpenItem={onOpenItem} />
                  ) : (
                    <ThreadPill lane={lane} breathing={shouldAnimate} onOpen={onToggle} />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          ))}
          {open && threads.length > 0 && (
            <motion.section className="r5a-lane" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: reveal }} aria-label={I.otherThreads}>
              <p className="typo-eyebrow px-2 pb-2">{I.otherThreads}</p>
              {threads.map((th) => (
                <Button
                  key={th.id}
                  variant="ghost"
                  className="r5a-row"
                  onClick={() => {
                    switchThread(th.id);
                    onOpenChat();
                  }}
                >
                  <span className="grid place-items-center text-primary">
                    <MessageCircleMore className="w-4 h-4" aria-hidden />
                  </span>
                  <span className="r5a-row-text">
                    <span className="typo-body text-foreground">{th.title}</span>
                  </span>
                  <span className="r5a-row-meta typo-caption">{I.unread(th.unread)}</span>
                </Button>
              ))}
            </motion.section>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
