import { useEffect, useRef, type CSSProperties } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { SECTION_IDS, type SectionId, type TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import BoxFrame, { useCardBox } from './BoxFrame';
import IdentityDrawing from './IdentityDrawing';
import KnowledgeDrawing from './KnowledgeDrawing';
import { Letter } from './Lettering';
import type { SheetDraw } from './OverviewSheet';
import ReadinessSlots from './ReadinessSlots';
import { SectionMark, SectionName } from './SectionHead';
import TrainingDetail from './TrainingDetail';
import VoiceSchedule from './VoiceSchedule';
import DrawFrame from './draw/DrawFrame';
import DrawSheet from './draw/DrawSheet';
import { DRAW_TIMING } from './draw/drawTiming';
import Write, { WriteNumber } from './draw/Write';
import { clipTo, type Insets } from './zoomOrigin';

/**
 * Layer two: one region zoomed to fill the sheet, as a drafter draws a
 * detail at a larger scale. The sheet opens out of the region it came from
 * (a clip that grows from the region's box to the whole sheet, so nothing is
 * scaled and no type is ever drawn small on the way) and the detail draws
 * itself in on the paper as it opens, the same way the plan did: its frame,
 * the frames inside it level by level, then every row in reading order. The
 * buttons are there from the start. Reduced motion: a fade, drawn at once.
 * Off paper (round 2 WP-C) the detail is drawn on a card, under the
 * section's own head.
 */
export default function FocusSheet({
  model,
  section,
  reduced,
  draw,
  origin,
  onBack,
  onOpenDetail,
}: {
  model: TwinBlueprintModel;
  section: SectionId;
  reduced: boolean;
  draw: SheetDraw;
  /** The activated region's box; `null` when the zoom was opened from outside (it fades in). */
  origin: Insets | null;
  onBack: () => void;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
}) {
  const { t, tx } = useTranslation();
  const b = t.twin.blueprint;
  const number = SECTION_IDS.indexOf(section) + 1;
  const coverage = sectionCoverage(model)[section];
  const card = useCardBox();
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus({ preventScroll: true }), [section]);
  // A CSS animation, not a script one: the compositor runs it, and the app's
  // reduced-motion reset (and the page harness's pinned clock) cannot strand
  // it half-grown.
  const grow = !reduced && origin;
  // CSSProperties declares no custom properties; the one key here is ours and read only by .twd-zoom-in.
  const from = grow ? ({ '--twd-zoom-from': clipTo(origin) } as CSSProperties) : undefined;

  return (
    <DrawSheet
      {...draw}
      offset={grow ? DRAW_TIMING.zoomLead : 0}
      className={`flex h-full min-h-0 flex-col gap-4 ${grow ? 'twd-zoom-in' : 'twd-fade-in'}`}
      style={from}
      data-testid={`twd-focus-${section}`}
      data-zoom={grow ? 'grow' : 'fade'}
    >
      <header className="flex min-w-0 items-center gap-3">
        <Button ref={backRef} variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>
          {b.nav.back}
        </Button>
        <SectionMark section={section} number={number} inked size={32} />
        <SectionName section={section} text={tx(b.variantCopy.drafting.detailOf, { section: b.sections[section] })} className="shrink-0" />
        <Write text={b.sectionHints[section]} className="min-w-0 truncate typo-caption" />
        <span className="ml-auto shrink-0">
          {coverage === null ? (
            <Write text={b.states.notMeasured} className="typo-caption" />
          ) : (
            <WriteNumber value={coverage} unit="ratio" precision={0} className="typo-data-lg text-foreground" />
          )}
        </span>
        <Button variant="secondary" size="sm" iconRight={<ArrowUpRight className="h-4 w-4" />} onClick={() => onOpenDetail(section)}>
          {b.nav.openDetail}
        </Button>
      </header>
      <div className={`${card} relative flex min-h-0 flex-1 flex-col px-6 py-5`} style={{ border: '1px solid transparent' }}>
        <BoxFrame
          paper={
            <>
              <DrawFrame stroke="var(--ink-faint)" width={3} edge={4} />
              <DrawFrame stroke="var(--ink)" />
            </>
          }
        />
        {section === 'identity' && (
          <div className="flex min-h-0 flex-col gap-10">
            <IdentityDrawing identity={model.identity} detailed />
            <div className="flex flex-col gap-1" data-draw-scope="">
              <Letter>{t.twin.profiles.role}</Letter>
              <Write text={model.identity.role ?? t.twin.experience.sheet.noRole} className="typo-body-lg text-foreground" />
            </div>
            <div className="flex flex-col gap-3" data-draw-scope="">
              <Letter>{b.metrics.readiness}</Letter>
              <ReadinessSlots slots={model.readiness.slots} large />
            </div>
          </div>
        )}
        {section === 'voice' && <VoiceSchedule voice={model.voice} onOpen={(channel) => onOpenDetail('voice', channel)} />}
        {section === 'knowledge' && <KnowledgeDrawing knowledge={model.knowledge} samplesOpen={model.samples.open} size="l2" />}
        {section === 'training' && <TrainingDetail training={model.training} reduced={reduced} onOpen={(key) => onOpenDetail('training', key)} />}
      </div>
    </DrawSheet>
  );
}
