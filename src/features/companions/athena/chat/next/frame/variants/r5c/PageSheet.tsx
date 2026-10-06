/**
 * Folio · the page. It stands on the foot and unrolls upward out of it (a clip
 * from the bottom edge), so the running line you clicked becomes the page's
 * last line rather than a button that summoned a panel. It holds the
 * conversation (with her tools along its left edge), or what a reference
 * opened in its place: her Brain, a report.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { AthenaToolbar } from '../../../../../AthenaToolbar';
import { BrainViewer } from '../../../../../BrainViewer';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { ReportReader } from '../../../../refs/ReportReader';
import type { LayerView } from '../../../useLayer';
import { FOLIO_COPY as C } from './copy';
import { FOLIO_EASE } from './marks';
import { ReadingPage } from './ReadingPage';

const closeBrain = () => useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null });

export function PageSheet({
  open,
  engine,
  view,
  onBack,
  onFold,
  onOpenWaiting,
  waiting,
}: {
  open: boolean;
  engine: AthenaChatEngine;
  view: LayerView;
  onBack: () => void;
  onFold: () => void;
  onOpenWaiting: () => void;
  waiting: number;
}) {
  const { shouldAnimate } = useMotion();
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  return (
    <div className="r5c-sheet-seat">
      <AnimatePresence>
        {open && (
          <motion.section
            className="r5c-sheet"
            role="region"
            aria-label={C.pageNamed}
            data-testid="companion-r5c-page"
            initial={shouldAnimate ? { clipPath: 'inset(100% 0 0 0)' } : { opacity: 0 }}
            animate={shouldAnimate ? { clipPath: 'inset(0% 0 0 0)' } : { opacity: 1 }}
            exit={shouldAnimate ? { clipPath: 'inset(100% 0 0 0)' } : { opacity: 0 }}
            transition={{ duration: shouldAnimate ? 0.42 : 0, ease: FOLIO_EASE }}
          >
            {brainOpen ? (
              <BrainViewer onClose={closeBrain} />
            ) : view.kind === 'report' ? (
              <ReportReader reportId={view.id} onClose={onBack} overlay={false} escToClose={false} />
            ) : (
              // Her tools (Brain, voice, connectors) bind the page's left edge
              // like a spine: there when you are with her, never at rest.
              <div className="r5c-sheet-cols">
                <div className="r5c-tools">
                  <AthenaToolbar dock="single" className="bg-transparent" />
                </div>
                <div className="r5c-sheet-col">
                  <ReadingPage engine={engine} onFold={onFold} onOpenWaiting={onOpenWaiting} waiting={waiting} />
                </div>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
