// Council - the descent from the registry galaxy, through the bench of
// councils waiting on a person, to one council's round table and its gate.
//
// The visual contract is `.claude/council-reference/index.html`: every
// build of this page is compared against it. This shell owns the header and
// the stage; the galaxy layer mounts inside, and the bench takes the `bench`
// slot below the field without ever hiding it.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Scale } from 'lucide-react';

import { MOTION_PRESETS } from '@/lib/utils/animation/animationPresets';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

import { CouncilBench } from './bench/CouncilBench';
import { effectiveSubject } from './bench/queueModel';
import { decidableCount } from './councilRules';
import { useCouncilStore } from './councilStore';
import { GalaxyStage } from './galaxy/GalaxyStage';
import { FusedStage } from './galaxy/fused/FusedStage';
import { COUNCIL_VARIANTS, COUNCIL_VARIANT_TAB_PREFIX, useCouncilVariant, type CouncilVariant } from './councilVariant';

export default function CouncilPage() {
  const { t, tx } = useTranslation();
  const b = t.council.bench;
  const v = t.council.variant;
  /* Classic or fused: two stages behind one persisted switch while the
     contest winner is promoted (`councilVariant.ts`). */
  const [variant, setVariant] = useCouncilVariant();
  const benchOpen = useCouncilStore((s) => s.benchOpen);
  const tableOpen = useCouncilStore((s) => s.tableSubjectId !== null);
  const setBenchOpen = useCouncilStore((s) => s.setBenchOpen);
  const focusCouncil = useCouncilStore((s) => s.focusCouncil);
  const rawSubjects = useCouncilStore((s) => s.subjects);
  const fixtureDecisions = useCouncilStore((s) => s.fixtureDecisions);
  const subjectsStatus = useCouncilStore((s) => s.subjectsStatus);
  const pendingSubjectId = useSystemStore((s) => s.pendingCouncilSubjectId);
  const setPendingCouncilSubjectId = useSystemStore((s) => s.setPendingCouncilSubjectId);

  const waiting = useMemo(
    () => decidableCount(rawSubjects.map((s) => effectiveSubject(s, fixtureDecisions))),
    [rawSubjects, fixtureDecisions],
  );

  // `Q` raises and drops the bench. It sits at the route layer, below the
  // bench's own handler, so while the bench is up its keys win.
  useAppKeyboard(
    useCallback(
      (e: KeyboardEvent) => {
        if (isTypingTarget(e.target)) return false;
        if (e.key !== 'q' && e.key !== 'Q') return false;
        setBenchOpen(!useCouncilStore.getState().benchOpen);
        return true;
      },
      [setBenchOpen],
    ),
    { priority: ROUTE_DECISION_PRIORITY },
  );

  // Leaving the page drops the bench, so a return lands on the sky rather
  // than inside a drawer the reader does not remember opening.
  useEffect(() => () => setBenchOpen(false), [setBenchOpen]);

  /* The ledger's `ready` row hands off here. The intent waits for the
     councils to arrive rather than being dropped on an empty list, and is
     cleared the moment it is honoured OR the moment the rows land without
     it, so a later visit opens the queue rather than re-opening a council
     the person has since decided. A subject id that no longer resolves is
     cleared too: a stale hand-off must not leave the page waiting forever. */
  useEffect(() => {
    if (!pendingSubjectId) return;
    if (subjectsStatus !== 'loaded') return;
    const s = useCouncilStore.getState();
    const found = s.subjects.find((row) => row.id === pendingSubjectId);
    setPendingCouncilSubjectId(null);
    if (!found) return;
    s.setBenchOpen(true);
    s.setTableSubject(found.id);
    s.focusCouncil(found, null);
  }, [pendingSubjectId, subjectsStatus, setPendingCouncilSubjectId]);

  /* The bench eats the bottom of the stage, and the field has to KNOW that:
     the engine frames the focused set in the space that is left rather than
     behind the drawer. Measured from the real element, because the height is
     a viewport clamp (`min(68vh, 580px)`) and a constant here would drift
     from the CSS the moment either side changes. */
  const benchRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const engine = useCouncilStore.getState().engine;
    const el = benchRef.current;
    if (!engine) return;
    if (!benchOpen || !el) {
      engine.setBenchHeight(0);
      return;
    }
    const push = () => {
      engine.setBenchHeight(el.getBoundingClientRect().height);
      // Re-frame: the focused set has to sit in the band the drawer leaves,
      // not behind it. Only a COUNCIL focus is re-aimed - re-flying a reader
      // who is standing somewhere in the field would move a camera they
      // placed themselves, and the bench promises to give that camera back.
      const { focus, engine: live } = useCouncilStore.getState();
      if (focus.kind === 'council') live?.setFocus(focus, true);
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => {
      ro.disconnect();
      engine.setBenchHeight(0);
    };
  }, [benchOpen, tableOpen]);

  /* One element type per variant, chosen before render so React mounts a
     fresh stage (and a fresh engine) when the switch flips. */
  const Stage = variant === 'fused' ? FusedStage : GalaxyStage;

  const aim = useCallback(
    (subject: CouncilSubjectState) => focusCouncil(subject, null),
    [focusCouncil],
  );

  return (
    <ContentBox data-testid="council-page">
      <ContentHeader
        icon={<Scale className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.sidebar.council}
        fitWidth
        actions={
          <div className="flex items-center gap-2">
          <SegmentedTabs<CouncilVariant>
            tabs={COUNCIL_VARIANTS.map((id) => ({
              id,
              label: id === 'classic' ? v.classic : v.fused,
              testId: `council-variant-${id}`,
            }))}
            activeTab={variant}
            onTabChange={setVariant}
            ariaLabel={v.switcher_aria}
            idPrefix={COUNCIL_VARIANT_TAB_PREFIX}
            size="sm"
            fullWidth={false}
          />
          <button
            type="button"
            onClick={() => setBenchOpen(!benchOpen)}
            aria-pressed={benchOpen}
            data-testid="council-bench-toggle"
            className={`inline-flex items-center gap-2 rounded-interactive border px-3 py-1.5 typo-body focus-ring ${
              benchOpen
                ? 'border-primary/60 bg-primary/15 text-primary'
                : 'border-border text-muted hover:text-foreground'
            }`}
          >
            {b.toggle}
            {waiting > 0 ? (
              <span className="rounded-pill bg-status-pending/20 px-1.5 tabular-nums text-status-pending">
                {waiting}
              </span>
            ) : null}
            <kbd className="rounded border border-current/40 px-1 font-mono opacity-70">Q</kbd>
          </button>
          </div>
        }
      />
      {/* `flex`, not the default body: the default wraps its children in a
          PADDED, `min-h-full` box inside a scroller, so a stage asking for
          `h-full` got the scroller's height MINUS the padding and the page
          ended short of the window with the field clipped inside it. The flex
          branch is `h-full` with no padding, which is what a stage needs. */}
      <ContentBody flex>
        {/* The variant strip promises it selects among mutually exclusive
            regions, so the stage DECLARES that it is one of them. */}
        <div
          role="tabpanel"
          id={`${COUNCIL_VARIANT_TAB_PREFIX}-panel-${variant}`}
          aria-labelledby={`${COUNCIL_VARIANT_TAB_PREFIX}-tab-${variant}`}
          data-testid="council-stage"
          className="relative flex min-h-0 flex-1 flex-col"
          data-variant={variant}
        >
          <Stage
            bench={
              /* The bench RISES. It is a drawer taking two thirds of the
                 field, which is the app's `gentle` rung (400 ms, a large
                 reveal) - the same rung the camera flies on, so the drawer
                 and the field it re-frames move together. Framer is gated
                 app-wide by `<MotionConfig reducedMotion="user">`, so a
                 reader who asked for reduced motion gets it in place. */
              <AnimatePresence>
              {benchOpen ? (
                <motion.section
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '100%', opacity: 0 }}
                  transition={MOTION_PRESETS.gentle.framer}
                  ref={benchRef}
                  data-testid="council-bench"
                  aria-label={tx(b.headline_many, { count: waiting })}
                  className={`absolute inset-x-0 bottom-0 z-30 flex min-h-0 flex-col border-t border-primary/15 bg-background shadow-elevation-4 ${
                    tableOpen ? 'top-0' : ''
                  }`}
                  /* Two shapes, and both are a share of the STAGE rather than
                     of the viewport - the reference's drawer is fixed to a
                     window whose whole height is field, while this one sits
                     inside a page that already spent its own header.
                     THE QUEUE keeps a band of sky: the whole point of council
                     focus is that the stars the selected subject lands on are
                     in view while you read its row.
                     THE ROUND TABLE takes the field entirely. It has a fixed
                     frame to fit - header, rose, reading, gate - and a
                     half-height table is a clipped table; the galaxy is still
                     alive behind it and the rail still lists its stars. */
                  style={tableOpen ? undefined : { height: '66%', minHeight: 300 }}
                >
                  <CouncilBench onFocusSubject={aim} />
                </motion.section>
              ) : null}
              </AnimatePresence>
            }
          />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
