/**
 * Level 3 — the Desk. One BaseModal, two postures:
 *  - the WORKING desk (approval, backlog, chat): the queue docked on the left,
 *    the item on the stage, the decision footer below;
 *  - the READING ROOM (report, council): the desk grows to the whole window,
 *    the queue narrows to a lamp column, contents + progress sit on the right.
 * Walking between an approval and a report in Triage all MORPHS one posture
 * into the other (layout animation), never a second modal.
 */
import { useId, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { CheckCheck } from 'lucide-react';
import type { DecisionItem } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';
import { DUR, EASE, headingsOf, readerMarkdown } from './model';
import { useDesk } from './useDesk';
import { useDeskKeys } from './useDeskKeys';
import { DeskRail } from './DeskRail';
import { DeskHeader } from './DeskHeader';
import { DeskFooter } from './DeskFooter';
import { DeskStage, VerdictStamp } from './DeskStage';
import { ChatComposer } from './stages/ChatStage';
import { ReasonPrompt } from './stages/ReasonPrompt';
import { ReportContents } from './stages/ReportContents';
import { useReading } from './stages/useReading';

interface Props {
  queue: DecisionItem[];
  startIndex: number;
  scopeLabel: string;
  reduced: boolean;
  onClose: () => void;
  onDecide: (v: PrototypeVerdict) => void;
}

export function Desk({ queue, startIndex, scopeLabel, reduced, onClose, onDecide }: Props) {
  const titleId = useId();
  const ctl = useDesk(queue, startIndex, onDecide);
  useDeskKeys(ctl, true);
  const item = ctl.item;
  const reading = ctl.type === 'report';
  const headings = useMemo(
    () => (item?.document?.format === 'markdown' ? headingsOf(readerMarkdown(item)) : []),
    [item],
  );
  const read = useReading(ctl.bodyRef, headings, item?.id ?? '');
  // BaseModal's Escape/backdrop is "step back ONE level": an armed verdict or an
  // open reason prompt is the nearer level, the desk itself the next one.
  const stepBack = () => (ctl.armed || ctl.reasonOpen ? ctl.cancel() : onClose());

  return (
    <BaseModal isOpen onClose={stepBack} titleId={titleId} portal staggerChildren={false}
      maxWidthClass="max-w-none" panelClassName="p3-desk-panel p3-root h-full">
      <motion.div
        layout={!reduced}
        transition={{ duration: DUR.normal, ease: EASE }}
        className={`p3-desk ${reading ? 'is-reading' : ''}`}
        data-testid="p3-desk"
        data-posture={reading ? 'reading' : 'working'}
      >
        <span tabIndex={0} className="sr-only">Decision desk — use the keys in the footer</span>
        <DeskRail queue={queue} active={ctl.index} decided={ctl.decided} scopeLabel={scopeLabel}
          slim={reading} reduced={reduced} onJump={ctl.jump} />
        <motion.section layout={!reduced ? 'position' : false} className="p3-stage" aria-labelledby={titleId}>
          {item ? (
            <>
              {reading && (
                <div className="p3-progress" aria-hidden>
                  <motion.span initial={false} animate={{ scaleX: read.progress }} transition={{ duration: 0 }} />
                </div>
              )}
              <DeskHeader item={item} titleId={titleId} index={ctl.index} total={ctl.total} onWalk={ctl.walk} onClose={onClose} />
              <div ref={ctl.bodyRef} className="p3-stage__body" tabIndex={-1}>
                <DeskStage ctl={ctl} reduced={reduced} />
              </div>
              {ctl.type === 'chat' && <ChatComposer key={item.id} item={item} ctl={ctl} />}
              <AnimatePresence>{ctl.reasonOpen && <ReasonPrompt ctl={ctl} reduced={reduced} />}</AnimatePresence>
              <DeskFooter ctl={ctl} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <h2 id={titleId} className="sr-only">Desk clear</h2>
              <ScenarioEmptyState icon={CheckCheck} title="Desk clear"
                subtitle="Everything in this queue is decided. Esc returns to the strip."
                action={{ label: 'Back', onClick: onClose }} />
            </div>
          )}
          <VerdictStamp stamp={ctl.stamp} reduced={reduced} />
          <span className="sr-only" aria-live="polite">{ctl.stamp?.label ?? ''}</span>
        </motion.section>
        {reading && item && (
          <ReportContents item={item} headings={headings} progress={read.progress} activeId={read.activeId} onJump={read.jumpTo} />
        )}
      </motion.div>
    </BaseModal>
  );
}
