/**
 * BlueprintSheet - the product blueprint drawn inside Personas (spark one-control, Stage 2, WP4a). A full-bleed
 * drafting sheet opened over the Decision Deck: the plan of the product on the right (a canvas in the kit's Figure
 * frame, five levels from the whole site to one feature), the Build queue beside it, and the dock console under the
 * queue printing every write the way the store answered it.
 *
 * It takes `data` and `actions` (the frozen seam in source.ts) and never calls IPC. It sits in the escape stack:
 * its keyboard handler registers above the deck's, so Esc climbs (overlay, armed build, L4 sheet, level by level)
 * and only at the whole-site level closes the sheet, never the deck behind it in the same press.
 */
import './theme/fonts';
import './blueprint.css';
import './styles/header.css';
import './styles/projects.css';
import './styles/rail.css';
import './styles/timeline.css';
import './styles/queue.css';
import './styles/dialog.css';
import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import { SheetContext } from './controller/SheetContext';
import { useSheetController } from './controller/useSheetController';
import type { BlueprintActions, BlueprintData } from './source';
import { FindDialog } from './ui/FindDialog';
import { HoverTip } from './ui/HoverTip';
import { KeyPlan } from './ui/KeyPlan';
import { KeySheet } from './ui/KeySheet';
import { LevelBar, ScaleReadout } from './ui/LevelBar';
import { PlanCanvas } from './ui/PlanCanvas';
import { QueueSidebar } from './ui/QueueSidebar';
import { ReasonDialog } from './ui/ReasonDialog';
import { RightRail } from './ui/RightRail';
import { TimelineStrip } from './ui/TimelineStrip';
import { TitleBlock } from './ui/TitleBlock';
import { FeatureSheet } from './ui/sheet/FeatureSheet';
import { LedgerPage } from './ledger/LedgerPage';
import { Flyout } from './ui/rail/Flyout';
import { TimelinePanel } from './ui/timeline/TimelinePanel';
import { DecisionCard } from './ui/overlays/DecisionCard';
import { SelBar } from './ui/overlays/SelBar';

export interface BlueprintSheetProps {
  data: BlueprintData;
  actions: BlueprintActions;
  /** Esc at the whole-site level, or the close control. */
  onClose: () => void;
  /** Open the L4 sheet of this feature at once (a Build card's item). */
  initialFeature?: string;
}

export function BlueprintSheet({ data, actions, onClose, initialFeature }: BlueprintSheetProps) {
  const root = useRef<HTMLDivElement>(null);
  const { sheet, words, hooks, tip, setEngine } = useSheetController({ data, actions, onClose, initialFeature });
  const { B, tx } = sheet.text;
  // the modal focuses its first control a frame after mount; the sheet takes the keyboard back for its keymap
  useEffect(() => {
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => root.current?.focus({ preventScroll: true })); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, []);
  const ov = sheet.ui.overlay;
  // The ledger is bp's full-width page: the Build queue column steps aside while it is up and returns with the plan.
  const queueShown = sheet.ui.queueOpen && sheet.ui.page === 'plan';
  const desc = tx(B.figure_desc, { features: sheet.plan.S.features.length, wings: sheet.plan.L.wings.length, waiting: sheet.queueAll.filter((p) => p.status === 'proposed').length });
  return (
    <BaseModal isOpen onClose={onClose} titleId="bp-title" portal maxWidthClass="max-w-none" panelClassName="bp-panel" staggerChildren={false}>
      <SheetContext.Provider value={sheet}>
        <div ref={root} className="bp-scope bp-root bp-sheet" tabIndex={-1} data-queue={queueShown ? 'open' : 'closed'} data-testid="blueprint-sheet">
          <span id="bp-title" className="sr-only">{B.title}</span>
          {queueShown && <QueueSidebar />}
          <div className="bp-plan">
            <PlanCanvas plan={sheet.plan} work={sheet.work} words={words} lens={sheet.ui.lens} view={sheet.view} hooks={hooks} onEngine={setEngine} desc={desc} />
            <TitleBlock />
            <RightRail />
            <KeyPlan />
            <LevelBar />
            <ScaleReadout />
            <TimelineStrip />
            <HoverTip store={tip} />
            {sheet.ui.page === 'plan' && <DecisionCard />}
            <SelBar />
            {sheet.ui.timelineOpen && <TimelinePanel />}
            <FeatureSheet />
            {sheet.ui.page === 'ledger' && <LedgerPage />}
            <AnimatePresence>{sheet.ui.flyout && <Flyout key="fly" />}</AnimatePresence>
          </div>
          {ov?.kind === 'find' && <FindDialog />}
          {ov?.kind === 'reason' && <ReasonDialog itemId={ov.itemId} move={ov.move} ids={ov.ids} />}
          {ov?.kind === 'help' && <KeySheet />}
        </div>
      </SheetContext.Provider>
    </BaseModal>
  );
}
