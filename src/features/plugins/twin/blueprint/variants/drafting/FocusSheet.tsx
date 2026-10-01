import { useEffect, useRef, type CSSProperties } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { SECTION_IDS, type SectionId, type TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import IdentityDrawing from './IdentityDrawing';
import KnowledgeDrawing from './KnowledgeDrawing';
import { Balloon, Letter } from './Lettering';
import ReadinessSlots from './ReadinessSlots';
import TrainingDetail from './TrainingDetail';
import VoiceSchedule from './VoiceSchedule';
import { clipTo, type Insets } from './zoomOrigin';

/**
 * Layer two: one region zoomed to fill the sheet, as a drafter draws a
 * detail at a larger scale. The sheet opens out of the region it came from
 * (a clip that grows from the region's box to the whole sheet, so nothing is
 * scaled and no type is ever drawn small on the way), the detailed drawing
 * fades in behind it, and every row that has more to say opens the full
 * detail drawer. Reduced motion: a fade.
 */
export default function FocusSheet({
  model,
  section,
  reduced,
  origin,
  onBack,
  onOpenDetail,
}: {
  model: TwinBlueprintModel;
  section: SectionId;
  reduced: boolean;
  /** The activated region's box; `null` when the zoom was opened from outside (it fades in). */
  origin: Insets | null;
  onBack: () => void;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
}) {
  const { t, tx } = useTranslation();
  const b = t.twin.blueprint;
  const number = SECTION_IDS.indexOf(section) + 1;
  const coverage = sectionCoverage(model)[section];
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus({ preventScroll: true }), [section]);
  // A CSS animation, not a script one: the compositor runs it, and the app's
  // reduced-motion reset (and the page harness's pinned clock) cannot strand
  // it half-grown.
  const grow = !reduced && origin;
  // CSSProperties declares no custom properties; the one key here is ours and read only by .twd-zoom-in.
  const from = grow ? ({ '--twd-zoom-from': clipTo(origin) } as CSSProperties) : undefined;

  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-4 ${grow ? 'twd-zoom-in' : 'twd-fade-in'}`}
      style={from}
      data-testid={`twd-focus-${section}`}
      data-zoom={grow ? 'grow' : 'fade'}
    >
      <header className="flex min-w-0 items-center gap-3">
        <Button ref={backRef} variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>
          {b.nav.back}
        </Button>
        <Balloon inked size={32}>
          {number}
        </Balloon>
        <Letter strong className="shrink-0">
          {tx(b.variantCopy.drafting.detailOf, { section: b.sections[section] })}
        </Letter>
        <span className="min-w-0 truncate typo-caption">{b.sectionHints[section]}</span>
        <span className="ml-auto shrink-0">
          {coverage === null ? (
            <span className="typo-caption">{b.states.notMeasured}</span>
          ) : (
            <Numeric value={coverage} unit="ratio" precision={0} className="typo-data-lg text-foreground" />
          )}
        </span>
        <Button variant="secondary" size="sm" iconRight={<ArrowUpRight className="h-4 w-4" />} onClick={() => onOpenDetail(section)}>
          {b.nav.openDetail}
        </Button>
      </header>
      <div
        className="relative flex min-h-0 flex-1 flex-col px-6 py-5"
        style={{ border: '1px solid var(--ink)', boxShadow: '0 0 0 3px var(--ink-faint)' }}
      >
        <div className="twd-fade-in flex min-h-0 flex-1 flex-col" style={{ animationDelay: reduced ? '0ms' : '320ms' }}>
          {section === 'identity' && (
            <div className="flex min-h-0 flex-col gap-10">
              <IdentityDrawing identity={model.identity} detailed drawn reduced={reduced} />
              <div className="flex flex-col gap-1">
                <Letter>{t.twin.profiles.role}</Letter>
                <p className="typo-body-lg text-foreground">{model.identity.role ?? t.twin.experience.sheet.noRole}</p>
              </div>
              <div className="flex flex-col gap-3">
                <Letter>{b.metrics.readiness}</Letter>
                <ReadinessSlots slots={model.readiness.slots} large />
              </div>
            </div>
          )}
          {section === 'voice' && <VoiceSchedule voice={model.voice} onOpen={(channel) => onOpenDetail('voice', channel)} />}
          {section === 'knowledge' && <KnowledgeDrawing knowledge={model.knowledge} samplesOpen={model.samples.open} size="l2" />}
          {section === 'training' && (
            <TrainingDetail training={model.training} reduced={reduced} onOpen={(key) => onOpenDetail('training', key)} />
          )}
        </div>
      </div>
    </div>
  );
}
